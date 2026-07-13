import React, { useState, useEffect, useRef, useCallback } from 'react';
import Echo from 'laravel-echo';
import Pusher from 'pusher-js';
import { Monitor, AlertCircle, Wifi, WifiOff } from 'lucide-react';

declare global {
  interface Window {
    Pusher: any;
    Echo: any;
  }
}

// Config variables
const MIDDLEWARE_URL = import.meta.env.VITE_DMS_MIDDLEWARE_URL || 'http://localhost:8000';
const REVERB_KEY    = import.meta.env.VITE_REVERB_APP_KEY  || 'dms-local-key';
const REVERB_HOST   = import.meta.env.VITE_REVERB_HOST     || 'localhost';
const REVERB_PORT   = import.meta.env.VITE_REVERB_PORT     || '8080';
const REVERB_SCHEME = import.meta.env.VITE_REVERB_SCHEME   || 'http';

function App() {
  const [displayId, setDisplayId] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('display_id') || localStorage.getItem('dms_display_id') || '';
    return id.toUpperCase();
  });

  const [inputDisplayId, setInputDisplayId] = useState('');
  const [deviceName, setDeviceName]         = useState('Memuat...');
  const [targetType, setTargetType]         = useState<string | null>(null);
  const [targetLabel, setTargetLabel]       = useState('');  // Human-readable name of current mapping
  const [wardData, setWardData]             = useState<any>(null);
  const [orData, setOrData]                 = useState<any[]>([]);
  const [orName, setOrName]                 = useState('');
  const [isOnline, setIsOnline]             = useState(false);
  const [errorMsg, setErrorMsg]             = useState('');
  const [currentTime, setCurrentTime]       = useState('');
  const [currentDate, setCurrentDate]       = useState('');
  const [lastUpdated, setLastUpdated]       = useState('');

  // useRef to keep fetchState stable across re-renders (prevents stale closures in Echo callbacks)
  const displayIdRef = useRef(displayId);
  useEffect(() => { displayIdRef.current = displayId; }, [displayId]);

  // Clock tick
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      setCurrentDate(now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' } as any));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Fetch current state of display mapping — wrapped in useCallback so Echo listener always uses latest
  const fetchState = useCallback(async (idOverride?: string) => {
    const id = idOverride || displayIdRef.current;
    if (!id) return;

    try {
      const response = await fetch(`${MIDDLEWARE_URL}/display/${id}/state`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Gagal mengambil data dari middleware.');

      const res = await response.json();

      if (res.data) {
        setDeviceName(res.data.name || 'Monitor STB');
        setTargetType(res.data.target_type || null);
        setIsOnline(true);
        setErrorMsg('');
        setLastUpdated(new Date().toLocaleTimeString('id-ID'));

        if (res.data.target_type === 'ward_class' && res.data.content) {
          const content = res.data.content;
          const label = content.class_name || content.name || 'Rawat Inap';
          setTargetLabel(label);
          setWardData(content);
          setOrData([]);
          setOrName('');
        } else if (res.data.target_type === 'operating_room' && res.data.content) {
          const content = res.data.content;
          const label = content.room_name || content.name || 'Kamar Operasi';
          setTargetLabel(label);
          setOrName(label);
          setOrData(content.schedules || []);
          setWardData(null);
        } else {
          setTargetLabel('');
          setWardData(null);
          setOrData([]);
          setOrName('');
        }
      } else {
        setDeviceName('Monitor Belum Terdaftar');
        setTargetType(null);
        setTargetLabel('');
      }
    } catch (err: any) {
      setIsOnline(false);
      setErrorMsg(err.message || 'Koneksi ke DMS Middleware gagal.');
    }
  }, []);

  // Heartbeat + initial fetch + periodic state re-fetch (fallback for when WebSocket fails)
  useEffect(() => {
    if (!displayId) return;

    // Initial fetch
    fetchState(displayId);

    // Heartbeat every 10s
    const sendHeartbeat = async () => {
      try {
        const res = await fetch(`${MIDDLEWARE_URL}/display/${displayId}/heartbeat`, { method: 'POST' });
        setIsOnline(res.ok);
      } catch {
        setIsOnline(false);
      }
    };
    sendHeartbeat();
    const heartbeatInterval = setInterval(sendHeartbeat, 10_000);

    // Fallback polling: re-fetch state every 15 seconds in case WebSocket misses an event
    const pollInterval = setInterval(() => fetchState(), 15_000);

    return () => {
      clearInterval(heartbeatInterval);
      clearInterval(pollInterval);
    };
  }, [displayId, fetchState]);

  // Laravel Echo WebSocket — instant refresh on mapping change
  useEffect(() => {
    if (!displayId) return;

    window.Pusher = Pusher;

    const echoInstance = new Echo({
      broadcaster: 'reverb',
      key: REVERB_KEY,
      wsHost: REVERB_HOST,
      wsPort: parseInt(REVERB_PORT),
      wssPort: parseInt(REVERB_PORT),
      forceTLS: REVERB_SCHEME === 'https',
      enabledTransports: ['ws', 'wss'],
    });

    // Listen to per-device mapping change channel — uses broadcastAs() name
    echoInstance
      .channel(`display.${displayId}`)
      .listen('.MappingUpdated', () => {
        console.log('[Display] MappingUpdated received, refreshing state…');
        fetchState();
      });

    // Listen to ward/OR data change on global channel
    echoInstance
      .channel('displays')
      .listen('.WardAvailabilityChanged', (e: any) => {
        // Only update if we're currently showing this ward class
        if (targetType === 'ward_class' && wardData && e.bpjs_class_code === wardData.bpjs_class_code) {
          setWardData((prev: any) => ({ ...prev, ...e }));
          setLastUpdated(new Date().toLocaleTimeString('id-ID'));
        }
      })
      .listen('.OperatingRoomStatusChanged', (e: any) => {
        if (targetType === 'operating_room') {
          setOrName(e.name || orName);
          setOrData(e.schedules || []);
          setLastUpdated(new Date().toLocaleTimeString('id-ID'));
        }
      });

    return () => {
      echoInstance.disconnect();
    };
  }, [displayId, fetchState]);

  const handleProvision = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputDisplayId.trim()) return;
    const cleanId = inputDisplayId.trim().toUpperCase();
    localStorage.setItem('dms_display_id', cleanId);
    setDisplayId(cleanId);
    const newUrl = `${window.location.protocol}//${window.location.host}${window.location.pathname}?display_id=${cleanId}`;
    window.history.pushState({ path: newUrl }, '', newUrl);
  };

  // ─── Provisioning screen ────────────────────────────────────────────────────
  if (!displayId) {
    return (
      <div className="setup-container">
        <form onSubmit={handleProvision} className="setup-card">
          <div className="mx-auto text-sky-400 mb-2">
            <Monitor size={48} />
          </div>
          <h2 className="setup-title">DMS Display Provisioning</h2>
          <p className="text-sm text-slate-400">Masukkan ID unik display monitor untuk mengaktifkan sinkronisasi konten STB.</p>
          <input
            type="text"
            value={inputDisplayId}
            onChange={(e) => setInputDisplayId(e.target.value)}
            placeholder="MISAL: DSP001"
            className="setup-input"
            required
          />
          <button type="submit" className="setup-button">Hubungkan Monitor</button>
        </form>
      </div>
    );
  }

  // ─── Main display screen ─────────────────────────────────────────────────────
  return (
    <div className="screen-container">
      {/* Header */}
      <div className="screen-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <div className="device-badge">{displayId}</div>
          <div>
            <h1 className="device-title">{deviceName}</h1>
            {targetLabel && (
              <div style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: '0.1rem' }}>
                📍 {targetLabel}
              </div>
            )}
            <div className="connection-status">
              <span className={`dot ${isOnline ? 'dot-online' : 'dot-offline'}`}></span>
              <span style={{ color: isOnline ? '#34d399' : '#f87171', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                {isOnline ? <><Wifi size={13} /> Connected</> : <><WifiOff size={13} /> Disconnected</>}
              </span>
            </div>
          </div>
        </div>

        <div className="clock-area">
          <div className="clock-time">{currentTime}</div>
          <div className="clock-date">{currentDate}</div>
        </div>
      </div>

      {/* Main Board */}
      <div className="board-area">
        {errorMsg && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', color: '#f87171' }}>
            <AlertCircle size={48} />
            <p className="text-lg font-semibold">{errorMsg}</p>
          </div>
        )}

        {/* Ward class view */}
        {!errorMsg && targetType === 'ward_class' && wardData && (
          <div className="ward-card">
            <div className="ward-header">
              <span className="ward-label">Status Ketersediaan Kamar Rawat Inap</span>
              <h2 className="ward-name">{wardData.class_name || wardData.name || targetLabel}</h2>
            </div>

            <div className="stats-grid">
              <div className="stat-box">
                <span className="stat-title">TOTAL BED</span>
                <span className="stat-value stat-value-total">{wardData.bed_total}</span>
              </div>
              <div className="stat-box">
                <span className="stat-title">TERISI</span>
                <span className="stat-value stat-value-occupied">{wardData.bed_occupied}</span>
              </div>
              <div className="stat-box stat-box-available">
                <span className="ward-label" style={{ color: '#34d399' }}>TERSEDIA (SISA)</span>
                <span className="stat-value stat-value-available">{wardData.bed_available}</span>
              </div>
            </div>
          </div>
        )}

        {/* Operating room schedule view */}
        {!errorMsg && targetType === 'operating_room' && (
          <div className="schedule-card">
            <div style={{ textAlign: 'center' }}>
              <span className="ward-label" style={{ color: '#c084fc' }}>Jadwal Tindakan</span>
              <h2 className="or-name">{orName || targetLabel}</h2>
            </div>

            {orData.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#64748b', padding: '2rem' }}>
                <p>Belum ada jadwal tindakan untuk hari ini.</p>
              </div>
            ) : (
              <div className="table-container">
                <table className="stb-table">
                  <thead>
                    <tr>
                      <th>ID JADWAL</th>
                      <th>NAMA PASIEN</th>
                      <th>RENCANA MULAI</th>
                      <th>MULAI AKTUAL</th>
                      <th>STATUS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orData.map((sch) => (
                      <tr key={sch.bpjs_schedule_id}>
                        <td style={{ fontFamily: 'monospace', fontSize: '0.95rem' }}>{sch.bpjs_schedule_id}</td>
                        <td style={{ fontWeight: 'bold', color: 'white' }}>{sch.patient_name}</td>
                        <td>{new Date(sch.scheduled_start_at).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}</td>
                        <td>{sch.actual_start_at ? new Date(sch.actual_start_at).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-'}</td>
                        <td>
                          {sch.status === 'selesai'              && <span className="badge badge-success">Selesai</span>}
                          {sch.status === 'sedang_dilaksanakan'  && <span className="badge badge-warning">Sedang Jalan</span>}
                          {sch.status === 'menunggu'             && <span className="badge badge-muted">Menunggu</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* No mapping yet */}
        {!errorMsg && !targetType && (
          <div className="setup-card" style={{ maxWidth: '480px' }}>
            <div className="mx-auto text-amber-400 mb-4">
              <AlertCircle size={48} />
            </div>
            <h2 className="setup-title" style={{ color: '#fbbf24' }}>Belum Ada Mapping</h2>
            <p className="text-slate-300 text-sm">Monitor display ini belum dikonfigurasi ke target data manapun pada Backoffice/Control Panel.</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="screen-footer">
        <span>STB Armbian Display Client — {displayId}</span>
        <span>Terakhir diperbarui: {lastUpdated || '-'}</span>
      </div>
    </div>
  );
}

export default App;
