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
  MapPin,
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
      setCurrentTime(now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/\./g, ':'));
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

  const renderHeader = () => {
    if (targetType === 'polyclinic') {
      return (
        <header>
          <div className="brand">
            <div className="logo">
              <img src="/logo-fallback.png" alt="Logo RSBA" />
            </div>
            <div>
              <div className="rs-name">Rumah Sakit Bintang Amin</div>
              <div className="rs-tag">We Care, We Cure</div>
            </div>
          </div>

          <div className="poli-title">
            <div className="poli-name">{poliData?.polyclinic_name || 'Poliklinik'}</div>
            <div className="poli-sub">Rawat Jalan &middot; Lantai 2</div>
          </div>

          <div className="clock-block">
            <div className="time" id="clock">{currentTime}</div>
            <div className="date" id="dateStr">{currentDate}</div>
          </div>
        </header>
      );
    }

    return (
      <header className="screen-header">
        <div className="brand-block">
          <img src="/logo-fallback.png" alt="Logo RSBA" className="brand-mark-img" />
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
  };

  const renderMetric = (label: string, value: string | number, hint: string, tone: 'cyan' | 'emerald' | 'amber' | 'rose') => (
    <div className={`premium-metric premium-metric-${tone}`}>
      <div className="premium-metric-glow"></div>
      <div className="premium-metric-content">
        <div className="metric-label">{label}</div>
        <div className="metric-value"><span className="value-number">{value}</span></div>
        <div className="metric-hint">{hint}</div>
      </div>
    </div>
  );

  const renderWardView = () => {
    if (!wardData || Array.isArray(wardData)) return null;

    return (
      <section className="premium-content-grid">
        <aside className="premium-hero-panel hero-ward">
          <div className="panel-kicker premium-kicker">
            <BedDouble size={18} /> Rawat Inap
          </div>
          <h2 className="premium-panel-title">{wardData.class_name || wardData.name || targetLabel}</h2>
          <p className="premium-panel-copy">
            Informasi ketersediaan kamar dibuat untuk dibaca cepat dari kejauhan.
          </p>

          <div className="premium-progress-group">
            <div className="premium-progress-item">
              <div className="progress-head">
                <span>Keterisian</span>
                <strong className="text-rose-400">{occupancyRate}%</strong>
              </div>
              <div className="premium-progress-track">
                <div className="premium-progress-fill fill-rose" style={{ width: `${occupancyRate}%` }}></div>
              </div>
            </div>

            <div className="premium-progress-item">
              <div className="progress-head">
                <span>Ketersediaan</span>
                <strong className="text-emerald-400">{availableRate}%</strong>
              </div>
              <div className="premium-progress-track">
                <div className="premium-progress-fill fill-emerald" style={{ width: `${availableRate}%` }}></div>
              </div>
            </div>
          </div>
        </aside>

        <div className="premium-dashboard-column">
          <div className="premium-metric-grid">
            {renderMetric('Total Bed', wardData.bed_total ?? '-', 'Kapasitas keseluruhan', 'cyan')}
            {renderMetric('Terisi', wardData.bed_occupied ?? '-', 'Pasien aktif', 'rose')}
            {renderMetric('Tersedia', wardData.bed_available ?? '-', 'Sisa tempat', 'emerald')}
          </div>

          <div className="premium-detail-panel">
            <div className="detail-header">
              <Stethoscope size={20} className="detail-icon" />
              <h3>Ringkasan Lokasi</h3>
            </div>
            <div className="premium-detail-grid">
              <div className="premium-detail-item">
                <span className="detail-lbl">Nama Kelas</span>
                <strong className="detail-val">{wardData.class_name || wardData.name || '-'}</strong>
              </div>
              <div className="premium-detail-item">
                <span className="detail-lbl">Gedung</span>
                <strong className="detail-val">{wardData.building || '-'}</strong>
              </div>
              <div className="premium-detail-item">
                <span className="detail-lbl">Lantai</span>
                <strong className="detail-val">{wardData.floor || '-'}</strong>
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
      <section className="premium-content-grid">
        <aside className="premium-hero-panel hero-inpatient">
          <div className="panel-kicker premium-kicker">
            <Building2 size={18} /> Ruang Spesifik
          </div>
          <h2 className="premium-panel-title">{wardData.name}</h2>
          <p className="premium-panel-copy">
            Monitor khusus ruangan untuk visibilitas cepat.
          </p>

          <div className="premium-info-stack">
            <div className="premium-info-item">
              <span className="info-lbl">Gedung</span>
              <strong className="info-val">{wardData.building}</strong>
            </div>
            <div className="premium-info-item">
              <span className="info-lbl">Lantai</span>
              <strong className="info-val">{wardData.floor}</strong>
            </div>
          </div>
        </aside>

        <div className="premium-dashboard-column">
          <div className="premium-metric-grid">
            {renderMetric('Total Kasur', wardData.bed_total ?? '-', 'Kapasitas', 'cyan')}
            {renderMetric('Terisi', wardData.bed_occupied ?? '-', 'Terpakai', 'rose')}
            {renderMetric('Tersedia', wardData.bed_available ?? '-', 'Kosong', 'emerald')}
          </div>

          <div className="premium-detail-panel">
            <div className="detail-header">
              <MapPin size={20} className="detail-icon" />
              <h3>Identitas Ruangan</h3>
            </div>
            <div className="premium-detail-grid">
              <div className="premium-detail-item">
                <span className="detail-lbl">Nama Ruang</span>
                <strong className="detail-val">{wardData.name || '-'}</strong>
              </div>
              <div className="premium-detail-item">
                <span className="detail-lbl">Kode Layanan</span>
                <strong className="detail-val">{wardData.code || targetLabel || '-'}</strong>
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
      <section className="premium-summary-layout">
        <aside className="premium-hero-panel hero-summary">
          <div className="panel-kicker premium-kicker">
            <CalendarClock size={18} /> Rekapitulasi
          </div>
          <h2 className="premium-panel-title">Ketersediaan Kamar Seluruh Kelas</h2>
          <p className="premium-panel-copy">
            Monitoring sentral kapasitas dan keterisian seluruh kelas rawat inap rumah sakit.
          </p>
        </aside>

        <div className="premium-table-panel">
          <table className="premium-table">
            <thead>
              <tr>
                <th>Kelas Kamar</th>
                <th>Kapasitas</th>
                <th>Terisi</th>
                <th>Tersedia</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {wardData.map((ward, idx) => {
                const perc = ward.bed_total ? (ward.bed_occupied / ward.bed_total) * 100 : 0;
                let statusClass = 'status-ok';
                let statusText = 'Aman';
                if (perc >= 90) { statusClass = 'status-critical'; statusText = 'Penuh'; }
                else if (perc >= 70) { statusClass = 'status-warning'; statusText = 'Hampir Penuh'; }

                return (
                  <tr key={idx} className="table-row-anim" style={{ animationDelay: `${idx * 0.05}s` }}>
                    <td className="premium-strong-cell">
                      <div className="cell-flex">
                        <BedDouble size={16} className="cell-icon" />
                        {ward.class_name || ward.name}
                      </div>
                    </td>
                    <td><span className="badge-pill bg-slate">{ward.bed_total}</span></td>
                    <td><span className="badge-pill bg-rose">{ward.bed_occupied}</span></td>
                    <td><span className="badge-pill bg-emerald">{ward.bed_available}</span></td>
                    <td><span className={`status-badge ${statusClass}`}>{statusText}</span></td>
                  </tr>
                );
              })}
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

    const servingPatient = queue.find(item => item.status === 'dilayani');
    const waitingPatients = queue.filter(item => item.status === 'menunggu');
    const skippedPatients = queue.filter(item => item.status === 'terlewat');

    return (
      <section className="poli-layout">
        {/* KOLOM KIRI (35-40%) */}
        <div className="poli-left-column">
          {/* Card Informasi Dokter */}
          <div className="card doctor-card">
            <div className="doctor-photo">
              {activeDoctor.photo_url ? (
                <img
                  src={activeDoctor.photo_url}
                  alt={activeDoctor.name}
                  className="doctor-avatar"
                />
              ) : (
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="12" cy="8" r="4" fill="currentColor" fill-opacity="0.85" />
                  <path d="M4 20C4 16.13 7.58 13 12 13C16.42 13 20 16.13 20 20" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                </svg>
              )}
            </div>
            <div className="doctor-info">
              <div className="doctor-name">{activeDoctor.name}</div>
              <div className="doctor-spec">
                {activeDoctor.specialty || `Spesialis ${poliData.polyclinic_name}`}
              </div>
              <div className="doctor-schedule">🕒 Senin–Jumat, 08.00 – 14.00</div>
            </div>

            {/* Doctor Switch Buttons (if > 1 doctor) */}
            {poliData.doctors.length > 1 && (
              <div className="doctor-navigation">
                <span className="nav-label">Dokter Lainnya:</span>
                <div className="doctor-switch-bar">
                  {poliData.doctors.map((doc, idx) => (
                    <button
                      key={doc.id}
                      className={`doctor-switch-btn ${idx === activeDoctorIndex ? 'active' : ''}`}
                      onClick={() => setActiveDoctorIndex(idx)}
                    >
                      {doc.name.split(',')[0]} {/* Shorten name */}
                    </button>
                  ))}
                </div>
                <div className="doctor-switch-note">
                  <Clock3 size={12} /> Otomatis berganti setiap 15 detik
                </div>
              </div>
            )}
          </div>

          {/* Card Nomor Antrian Sedang Dilayani */}
          <div className="card queue-hero">
            <span className="badge-serving"><span className="dot"></span> Sedang Dilayani</span>
            <div className="queue-number">
              {servingPatient ? servingPatient.queue_number : '-'}
            </div>
            <div className="queue-patient">
              {servingPatient ? servingPatient.patient_name : 'Tidak ada pasien'}
            </div>
            <div className="queue-room">
              {deviceName}
            </div>
          </div>
        </div>

        {/* KOLOM KANAN (60-65%) */}
        <div className="poli-right-column">
          {/* Card Daftar Antrian Menunggu */}
          <div className="card table-card">
            <div className="table-card-head">
              <h2>Daftar Antrian Menunggu</h2>
              <span className="count-pill">{waitingPatients.length} Pasien</span>
            </div>

            {waitingPatients.length === 0 ? (
              <div className="empty-queue-state">
                <Clock3 size={28} />
                <p>Belum ada antrian menunggu untuk dokter ini.</p>
              </div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: '100px' }}>No.</th>
                      <th>Nama Pasien</th>
                      <th style={{ textAlign: 'right' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {waitingPatients.map((item) => (
                      <tr key={`${item.queue_number}-${item.patient_name}`}>
                        <td className="num">{item.queue_number}</td>
                        <td className="name">{item.patient_name}</td>
                        <td className="status">
                          <span className="status-badge status-waiting">Menunggu</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Card Pasien Terlewat */}
          <div className="card missed-card">
            <div className="missed-card-head">
              <h3>Pasien Terlewat</h3>
              <span className="count-pill" style={{ background: 'var(--red-100)', color: 'var(--red-500)' }}>
                {skippedPatients.length} Pasien
              </span>
            </div>
            {skippedPatients.length === 0 ? (
              <p className="empty-skipped-text">Tidak ada pasien terlewat.</p>
            ) : (
              <div className="missed-list">
                {skippedPatients.map((item) => (
                  <div key={`${item.queue_number}-${item.patient_name}`} className="missed-chip">
                    <span className="num">{item.queue_number}</span>
                    <span>{item.patient_name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
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
          <img src="/logo-fallback.png" alt="Logo RSBA" className="setup-icon-img" />
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
    <div className={`screen-container ${targetType === 'polyclinic' ? 'light-theme' : ''}`}>
      {renderHeader()}

      <main className={targetType === 'polyclinic' ? 'body-wrap' : 'board-area'}>
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
