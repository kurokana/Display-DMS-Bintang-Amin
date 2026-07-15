import React, { useState, useEffect, useRef, useCallback } from 'react';
import Echo from 'laravel-echo';
import Pusher from 'pusher-js';
import './App.css';
import {
  AlertCircle,
  ArrowRight,
  BedDouble,
  Building2,
  CalendarClock,
  Clock3,
  HeartPulse,
  MapPin,
  Monitor,
  ShieldPlus,
  Sparkles,
  Stethoscope,
  Scissors,
  Wifi,
  WifiOff,
} from 'lucide-react';

declare global {
  interface Window {
    Pusher: any;
    Echo: any;
  }
}

// ─── Polyclinic Types ──────────────────────────────────────────────────────────
interface PoliQueueItem {
  queue_number: number;
  patient_name: string;
  status: 'menunggu' | 'dilayani' | 'selesai' | 'terlewat';
  called_at: string | null;
}

interface PoliDoctor {
  id: string;
  name: string;
  photo_url: string | null;
  specialty: string | null;
  queue: PoliQueueItem[];
}

interface PoliData {
  polyclinic_code: string;
  polyclinic_name: string;
  doctors: PoliDoctor[];
}

// Config variables
const MIDDLEWARE_URL = import.meta.env.VITE_DMS_MIDDLEWARE_URL || 'http://localhost:8000';
const REVERB_KEY = import.meta.env.VITE_REVERB_APP_KEY || 'dms-local-key';
const REVERB_HOST = import.meta.env.VITE_REVERB_HOST || 'localhost';
const REVERB_PORT = import.meta.env.VITE_REVERB_PORT || '8080';
const REVERB_SCHEME = import.meta.env.VITE_REVERB_SCHEME || 'http';

function App() {
  const [displayId, setDisplayId] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('display_id') || localStorage.getItem('dms_display_id') || '';
    return id.toUpperCase();
  });

  const [inputDisplayId, setInputDisplayId] = useState('');
  const [deviceName, setDeviceName] = useState('Memuat...');
  const [targetType, setTargetType] = useState<string | null>(null);
  const [targetLabel, setTargetLabel] = useState('');  // Human-readable name of current mapping
  const [wardData, setWardData] = useState<any>(null);
  const [orData, setOrData] = useState<any[]>([]);
  const [orName, setOrName] = useState('');
  const [poliData, setPoliData] = useState<PoliData | null>(null);
  const [activeDoctorIndex, setActiveDoctorIndex] = useState(0);
  const [isOnline, setIsOnline] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [currentTime, setCurrentTime] = useState('');
  const [currentDate, setCurrentDate] = useState('');
  const [lastUpdated, setLastUpdated] = useState('');

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

  const occupancyRate =
    wardData && !Array.isArray(wardData) && wardData.bed_total
      ? Math.max(0, Math.min(100, Math.round(((wardData.bed_occupied || 0) / wardData.bed_total) * 100)))
      : 0;

  const availableRate =
    wardData && !Array.isArray(wardData) && wardData.bed_total
      ? Math.max(0, Math.min(100, Math.round(((wardData.bed_available || 0) / wardData.bed_total) * 100)))
      : 0;

  const scheduleCounts = orData.reduce(
    (acc, schedule) => {
      if (schedule.status === 'selesai') acc.done += 1;
      else if (schedule.status === 'sedang_dilaksanakan') acc.running += 1;
      else acc.waiting += 1;
      return acc;
    },
    { done: 0, running: 0, waiting: 0 },
  );

  const renderStatusPill = () => (
    <div className="connection-status-pill">
      <span className={`dot ${isOnline ? 'dot-online' : 'dot-offline'}`}></span>
      {isOnline ? <Wifi size={14} /> : <WifiOff size={14} />}
      <span>{isOnline ? 'Tersambung ke middleware' : 'Koneksi terputus'}</span>
    </div>
  );

  const renderHeader = () => (
    <header className="screen-header">
      <div className="brand-block">
        <div className="brand-mark">
          <HeartPulse size={22} />
        </div>
        <div>
          <div className="brand-kicker">Rumah Sakit Bintang Amin</div>
          <h1 className="device-title">{deviceName}</h1>
          <div className="header-meta">
            <span className="device-badge">DISPLAY {displayId}</span>
            {targetLabel && (
              <span className="target-chip">
                <MapPin size={14} /> {targetLabel}
              </span>
            )}
          </div>
          {renderStatusPill()}
        </div>
      </div>

      <div className="clock-panel">
        <div className="clock-time">{currentTime}</div>
        <div className="clock-date">{currentDate}</div>
        <div className="clock-subtitle">
          <Sparkles size={14} /> Display informasi layanan pasien
        </div>
      </div>
    </header>
  );

  const renderMetric = (label: string, value: string | number, hint: string, tone: 'cyan' | 'emerald' | 'amber' | 'rose') => (
    <div className={`metric-card metric-${tone}`}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-hint">{hint}</div>
    </div>
  );

  const renderWardView = () => {
    if (!wardData || Array.isArray(wardData)) return null;

    return (
      <section className="content-grid content-grid-ward">
        <aside className="hero-panel hero-panel-ward">
          <div className="panel-kicker">
            <BedDouble size={16} /> Rawat Inap
          </div>
          <h2 className="panel-title">{wardData.class_name || wardData.name || targetLabel}</h2>
          <p className="panel-copy">
            Informasi ketersediaan kamar dibuat untuk dibaca cepat dari kejauhan, dengan penekanan pada jumlah kapasitas, keterisian, dan sisa tempat.
          </p>

          <div className="hero-progress">
            <div className="hero-progress-head">
              <span>Keterisian ruangan</span>
              <strong>{occupancyRate}%</strong>
            </div>
            <div className="progress-track">
              <div className="progress-fill progress-fill-ward" style={{ width: `${occupancyRate}%` }}></div>
            </div>
          </div>

          <div className="hero-progress">
            <div className="hero-progress-head">
              <span>Ketersediaan tempat</span>
              <strong>{availableRate}%</strong>
            </div>
            <div className="progress-track">
              <div className="progress-fill progress-fill-available" style={{ width: `${availableRate}%` }}></div>
            </div>
          </div>

          <div className="hero-note">
            <ShieldPlus size={18} /> Tampilan difokuskan untuk area display rumah sakit dan mudah dipantau dari jarak jauh.
          </div>
        </aside>

        <div className="dashboard-column">
          <div className="metric-grid">
            {renderMetric('Total Bed', wardData.bed_total ?? '-', 'Kapasitas seluruh tempat tidur', 'cyan')}
            {renderMetric('Terisi', wardData.bed_occupied ?? '-', 'Pasien aktif dirawat', 'rose')}
            {renderMetric('Tersedia', wardData.bed_available ?? '-', 'Sisa tempat siap pakai', 'emerald')}
          </div>

          <div className="detail-panel">
            <div className="detail-panel-title">
              <Stethoscope size={18} /> Ringkasan ruang rawat inap
            </div>
            <div className="detail-list">
              <div className="detail-row">
                <span>Nama kelas</span>
                <strong>{wardData.class_name || wardData.name || '-'}</strong>
              </div>
              <div className="detail-row">
                <span>Gedung</span>
                <strong>{wardData.building || '-'}</strong>
              </div>
              <div className="detail-row">
                <span>Lantai</span>
                <strong>{wardData.floor || '-'}</strong>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  };

  const renderInpatientRoomView = () => {
    if (!wardData || Array.isArray(wardData)) return null;

    return (
      <section className="content-grid content-grid-inpatient">
        <aside className="hero-panel hero-panel-inpatient">
          <div className="panel-kicker">
            <Building2 size={16} /> Ruang Rawat Inap
          </div>
          <h2 className="panel-title">{wardData.name}</h2>
          <p className="panel-copy">
            Monitor ini menampilkan satu ruangan spesifik agar petugas dapat melihat status ruangan, gedung, dan lantai dengan cepat.
          </p>

          <div className="info-stack">
            <div className="info-item">
              <span>Gedung</span>
              <strong>{wardData.building}</strong>
            </div>
            <div className="info-item">
              <span>Lantai</span>
              <strong>{wardData.floor}</strong>
            </div>
          </div>
        </aside>

        <div className="dashboard-column">
          <div className="metric-grid">
            {renderMetric('Total Kasur', wardData.bed_total ?? '-', 'Jumlah keseluruhan bed', 'cyan')}
            {renderMetric('Terisi', wardData.bed_occupied ?? '-', 'Bed yang sedang terpakai', 'rose')}
            {renderMetric('Tersedia', wardData.bed_available ?? '-', 'Bed kosong siap ditempati', 'emerald')}
          </div>

          <div className="detail-panel">
            <div className="detail-panel-title">
              <MapPin size={18} /> Lokasi dan identitas ruangan
            </div>
            <div className="detail-list">
              <div className="detail-row">
                <span>Nama ruang</span>
                <strong>{wardData.name || '-'}</strong>
              </div>
              <div className="detail-row">
                <span>Kode layanan</span>
                <strong>{wardData.code || targetLabel || '-'}</strong>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  };

  const renderWardSummaryView = () => {
    if (!wardData || !Array.isArray(wardData)) return null;

    return (
      <section className="summary-layout">
        <aside className="hero-panel hero-panel-summary">
          <div className="panel-kicker">
            <CalendarClock size={16} /> Summary Rawat Inap
          </div>
          <h2 className="panel-title">Ketersediaan kamar semua kelas</h2>
          <p className="panel-copy">
            Tampilan ringkas untuk monitoring keseluruhan kamar, cocok untuk display utama di area perawat atau lobi.
          </p>
          <div className="summary-hero-badge">
            <ArrowRight size={16} /> Scroll daftar untuk melihat seluruh kelas
          </div>
        </aside>

        <div className="table-panel">
          <table className="display-table">
            <thead>
              <tr>
                <th>Kelas kamar</th>
                <th>Total kapasitas</th>
                <th>Terisi</th>
                <th>Tersedia</th>
              </tr>
            </thead>
            <tbody>
              {wardData.map((ward, idx) => (
                <tr key={idx}>
                  <td className="table-strong">{ward.class_name || ward.name}</td>
                  <td>{ward.bed_total}</td>
                  <td className="text-danger">{ward.bed_occupied}</td>
                  <td className="text-success">{ward.bed_available}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  };

  const renderOperatingRoomView = () => {
    return (
      <section className="or-layout">
        <aside className="hero-panel hero-panel-or">
          <div className="panel-kicker">
            <Scissors size={16} /> Ruang Operasi
          </div>
          <h2 className="panel-title">{orName || targetLabel || 'Jadwal Tindakan Operasi'}</h2>
          <p className="panel-copy">
            Prioritaskan visibilitas jadwal tindakan, status pasien, dan waktu mulai agar mudah dibaca oleh tim bedah dan ruang operasi.
          </p>

          <div className="or-stats-grid">
            <div className="or-stat">
              <span>Menunggu</span>
              <strong>{scheduleCounts.waiting}</strong>
            </div>
            <div className="or-stat">
              <span>Berjalan</span>
              <strong>{scheduleCounts.running}</strong>
            </div>
            <div className="or-stat">
              <span>Selesai</span>
              <strong>{scheduleCounts.done}</strong>
            </div>
          </div>
        </aside>

        <div className="table-panel table-panel-or">
          {orData.length === 0 ? (
            <div className="empty-state">
              <Clock3 size={32} />
              <p>Belum ada jadwal tindakan untuk hari ini.</p>
            </div>
          ) : (
            <table className="display-table display-table-or">
              <thead>
                <tr>
                  <th>ID Jadwal</th>
                  <th>Nama pasien</th>
                  <th>Rencana mulai</th>
                  <th>Mulai aktual</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {orData.map((sch) => (
                  <tr key={sch.bpjs_schedule_id}>
                    <td className="mono-cell">{sch.bpjs_schedule_id}</td>
                    <td className="table-strong">{sch.patient_name}</td>
                    <td>{new Date(sch.scheduled_start_at).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}</td>
                    <td>{sch.actual_start_at ? new Date(sch.actual_start_at).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-'}</td>
                    <td>
                      {sch.status === 'selesai' && <span className="status-badge status-success">Selesai</span>}
                      {sch.status === 'sedang_dilaksanakan' && <span className="status-badge status-warning">Sedang Jalan</span>}
                      {sch.status === 'menunggu' && <span className="status-badge status-muted">Menunggu</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    );
  };

  // Auto-rotate doctors on poli view (every 15 seconds)
  useEffect(() => {
    if (!poliData || poliData.doctors.length <= 1) return;
    const interval = setInterval(() => {
      setActiveDoctorIndex(prev => (prev + 1) % poliData.doctors.length);
    }, 15_000);
    return () => clearInterval(interval);
  }, [poliData]);

  // Reset doctor index when poli data changes (e.g. new mapping)
  useEffect(() => {
    if (poliData && activeDoctorIndex >= poliData.doctors.length) {
      setActiveDoctorIndex(0);
    }
  }, [poliData, activeDoctorIndex]);

  const renderPolyclinicView = () => {
    if (!poliData || poliData.doctors.length === 0) {
      return (
        <div className="poli-closed-container">
          <div className="poli-closed-card">
            <div className="poli-closed-icon">
              <CalendarClock size={64} />
            </div>
            <span className="poli-closed-tag">Layanan Selesai / Tidak Ada Praktik</span>
            <h2>{poliData?.polyclinic_name || 'Poliklinik'}</h2>
            <div className="poli-closed-divider"></div>
            <p className="poli-closed-message">
              Saat ini tidak ada jadwal praktik dokter yang aktif di poliklinik ini.
            </p>
            <p className="poli-closed-submessage">
              Terima kasih atas kunjungan Anda. Silakan hubungi bagian pendaftaran untuk informasi jadwal praktik dokter selanjutnya.
            </p>
            <div className="poli-closed-footer">
              <Clock3 size={16} /> RSBA Smart Queue System
            </div>
          </div>
        </div>
      );
    }

    const activeDoctor = poliData.doctors[activeDoctorIndex] || poliData.doctors[0];
    const queue = activeDoctor.queue || [];

    const queueCounts = queue.reduce(
      (acc, item) => {
        if (item.status === 'menunggu') acc.waiting += 1;
        else if (item.status === 'dilayani') acc.serving += 1;
        else if (item.status === 'selesai') acc.done += 1;
        else if (item.status === 'terlewat') acc.skipped += 1;
        return acc;
      },
      { waiting: 0, serving: 0, done: 0, skipped: 0 },
    );

    return (
      <section className="poli-layout">
        <aside className="hero-panel hero-panel-poli">
          <div className="panel-kicker">
            <Stethoscope size={16} /> Poliklinik
          </div>
          <h2 className="panel-title">{poliData.polyclinic_name}</h2>

          {/* Doctor Photo */}
          <div className="doctor-photo-container">
            {activeDoctor.photo_url ? (
              <img
                src={activeDoctor.photo_url}
                alt={activeDoctor.name}
                className="doctor-photo"
              />
            ) : (
              <div className="doctor-photo doctor-photo-placeholder">
                <Stethoscope size={48} />
              </div>
            )}
          </div>

          {/* Doctor Info */}
          <div className="doctor-info">
            <h3 className="doctor-name">{activeDoctor.name}</h3>
            {activeDoctor.specialty && (
              <p className="doctor-specialty">{activeDoctor.specialty}</p>
            )}
          </div>

          {/* Queue Stats */}
          <div className="poli-stats-grid">
            <div className="poli-stat">
              <span>Menunggu</span>
              <strong>{queueCounts.waiting}</strong>
            </div>
            <div className="poli-stat">
              <span>Dilayani</span>
              <strong>{queueCounts.serving}</strong>
            </div>
            <div className="poli-stat">
              <span>Selesai</span>
              <strong>{queueCounts.done}</strong>
            </div>
          </div>

          {/* Doctor Switch Buttons */}
          {poliData.doctors.length > 1 && (
            <div className="doctor-switch-bar">
              {poliData.doctors.map((doc, idx) => (
                <button
                  key={doc.id}
                  className={`doctor-switch-btn ${idx === activeDoctorIndex ? 'active' : ''}`}
                  onClick={() => setActiveDoctorIndex(idx)}
                >
                  {doc.name}
                </button>
              ))}
            </div>
          )}

          {poliData.doctors.length > 1 && (
            <div className="hero-note">
              <Clock3 size={16} /> Tampilan berganti otomatis setiap 15 detik
            </div>
          )}
        </aside>

        <div className="table-panel table-panel-poli">
          {queue.length === 0 ? (
            <div className="empty-state">
              <Clock3 size={32} />
              <p>Belum ada antrian untuk dokter ini hari ini.</p>
            </div>
          ) : (
            <table className="display-table display-table-poli">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Nama Pasien</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((item) => (
                  <tr
                    key={`${item.queue_number}-${item.patient_name}`}
                    className={
                      item.status === 'dilayani'
                        ? 'queue-row-serving'
                        : item.status === 'terlewat'
                        ? 'queue-row-skipped'
                        : ''
                    }
                  >
                    <td>
                      <span
                        className={`queue-number ${
                          item.status === 'dilayani' ? 'queue-number-serving' : ''
                        }`}
                      >
                        {item.queue_number}
                      </span>
                    </td>
                    <td
                      className={`table-strong ${
                        item.status === 'terlewat' ? 'queue-name-skipped' : ''
                      }`}
                    >
                      {item.patient_name}
                    </td>
                    <td>
                      {item.status === 'menunggu' && (
                        <span className="status-badge status-muted">Menunggu</span>
                      )}
                      {item.status === 'dilayani' && (
                        <span className="status-badge status-warning">Dilayani</span>
                      )}
                      {item.status === 'selesai' && (
                        <span className="status-badge status-success">Selesai</span>
                      )}
                      {item.status === 'terlewat' && (
                        <span className="status-badge status-danger">Terlewat</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    );
  };

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
        } else if (res.data.target_type === 'ward_summary' && Array.isArray(res.data.content)) {
          setTargetLabel('Ketersediaan Kamar Rawat Inap (Semua Kelas)');
          setWardData(res.data.content); // Array of wards
          setOrData([]);
          setOrName('');
        } else if (res.data.target_type === 'operating_room' && res.data.content) {
          const content = res.data.content;
          const label = content.room_name || content.name || 'Kamar Operasi';
          setTargetLabel(label);
          setOrName(label);
          setOrData(content.schedules || []);
          setWardData(null);
        } else if (res.data.target_type === 'inpatient_room' && res.data.content) {
          const content = res.data.content;
          const label = `${content.name} (Gedung ${content.building} - Lantai ${content.floor})`;
          setTargetLabel(label);
          setWardData(content);
          setOrData([]);
          setOrName('');
          setPoliData(null);
        } else if (res.data.target_type === 'polyclinic' && res.data.content) {
          const content = res.data.content;
          setTargetLabel(content.polyclinic_name);
          setPoliData(content);
          setWardData(null);
          setOrData([]);
          setOrName('');
        } else {
          setTargetLabel('');
          setWardData(null);
          setOrData([]);
          setOrName('');
          setPoliData(null);
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
        if (targetType === 'ward_class' && wardData && !Array.isArray(wardData) && e.bpjs_class_code === wardData.bpjs_class_code) {
          setWardData((prev: any) => ({ ...prev, ...e }));
          setLastUpdated(new Date().toLocaleTimeString('id-ID'));
        } else if (targetType === 'ward_summary' && Array.isArray(wardData)) {
          setWardData((prev: any[]) => prev.map(ward => ward.bpjs_class_code === e.bpjs_class_code ? { ...ward, ...e } : ward));
          setLastUpdated(new Date().toLocaleTimeString('id-ID'));
        }
      })
      .listen('.OperatingRoomStatusChanged', (e: any) => {
        if (targetType === 'operating_room') {
          setOrName(e.name || orName);
          setOrData(e.schedules || []);
          setLastUpdated(new Date().toLocaleTimeString('id-ID'));
        }
      })
      .listen('.InpatientRoomAvailabilityChanged', () => {
        console.log('[Display] InpatientRoomAvailabilityChanged received, refreshing state…');
        fetchState();
      })
      .listen('.PolyclinicQueueChanged', () => {
        console.log('[Display] PolyclinicQueueChanged received, refreshing state…');
        if (targetType === 'polyclinic') {
          fetchState();
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
        <div className="setup-backdrop"></div>
        <form onSubmit={handleProvision} className="setup-card">
          <div className="setup-icon">
            <Monitor size={44} />
          </div>
          <div className="setup-kicker">Rumah Sakit Bintang Amin</div>
          <h2 className="setup-title">Display Ruangan Rawat Inap & Operasi</h2>
          <p className="setup-copy">Masukkan ID display agar monitor tersambung ke data ruangan yang sesuai pada sistem DMS.</p>
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
      {renderHeader()}

      <main className="board-area">
        {errorMsg && (
          <div className="error-card">
            <AlertCircle size={48} />
            <h2>Gagal memuat display</h2>
            <p>{errorMsg}</p>
          </div>
        )}

        {!errorMsg && targetType === 'ward_class' && renderWardView()}
        {!errorMsg && targetType === 'inpatient_room' && renderInpatientRoomView()}
        {!errorMsg && targetType === 'ward_summary' && renderWardSummaryView()}
        {!errorMsg && targetType === 'operating_room' && renderOperatingRoomView()}
        {!errorMsg && targetType === 'polyclinic' && renderPolyclinicView()}

        {!errorMsg && !targetType && (
          <div className="empty-mapping-card">
            <div className="empty-mapping-icon">
              <AlertCircle size={44} />
            </div>
            <h2>Belum ada mapping display</h2>
            <p>Monitor ini belum diarahkan ke data rawat inap atau ruang operasi dari Backoffice.</p>
          </div>
        )}
      </main>

      <footer className="screen-footer">
        <div className="footer-left">
          <span className="footer-label">DMS Display Client</span>
          <span>{displayId}</span>
        </div>
        <div className="footer-right">
          <span>Terakhir diperbarui: {lastUpdated || '-'}</span>
        </div>
      </footer>
    </div>
  );
}

export default App;
