import React, { useState, useEffect, useRef, useCallback } from 'react';
import Echo from 'laravel-echo';
import Pusher from 'pusher-js';
import './App.css';
import {
  AlertCircle,
  BedDouble,
  Building2,
  CalendarClock,
  Clock3,
  Stethoscope,
  Scissors,
  UserCheck,
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

  const renderHeader = () => {
    let headerTitle = 'Poliklinik';
    let headerSub = 'Layanan Poliklinik';

    if (targetType === 'polyclinic') {
      headerTitle = poliData?.polyclinic_name || 'Poliklinik';
      headerSub = poliData?.polyclinic_code || 'Layanan Poliklinik';
    } else if (targetType === 'ward_class') {
      headerTitle = wardData?.class_name || wardData?.name || targetLabel || 'Rawat Inap';
      headerSub = `Kamar Rawat Inap`;
    } else if (targetType === 'inpatient_room') {
      headerTitle = wardData?.name || targetLabel || 'Ruang Rawat Inap';
      headerSub = `Ruangan Rawat Inap`;
    } else if (targetType === 'ward_summary') {
      headerTitle = 'Ketersediaan Kamar Rawat Inap';
      headerSub = `Rekapitulasi Semua Kelas`;
    } else if (targetType === 'operating_room') {
      headerTitle = orName || targetLabel || 'Jadwal Kamar Operasi';
      headerSub = `Kamar Operasi`;
    }

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
          <div className="poli-name">{headerTitle}</div>
          <div className="poli-sub" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
            <span>{headerSub}</span>
            <span style={{ fontSize: '11px', color: isOnline ? 'var(--green-600)' : 'var(--gray-500)', fontWeight: 600 }}>
              {isOnline ? '● Connected' : '● Offline'}
            </span>
          </div>
        </div>

        <div className="clock-block">
          <div className="time" id="clock">{currentTime}</div>
          <div className="date" id="dateStr">{currentDate}</div>
        </div>
      </header>
    );
  };

  const renderWardView = () => {
    if (!wardData || Array.isArray(wardData)) return null;

    return (
      <section className="poli-layout">
        <div className="poli-left-column">
          <div className="hero-card-light">
            <div className="hero-badge">
              <BedDouble size={16} /> Rawat Inap
            </div>
            <h2 className="hero-title">{wardData.class_name || wardData.name || targetLabel}</h2>
            <p className="hero-copy">
              Informasi ketersediaan dan keterisian tempat tidur kelas rawat inap.
            </p>

            <div className="hero-progress-stack">
              <div className="hero-progress-box">
                <div className="progress-meta">
                  <span>Keterisian</span>
                  <span>{occupancyRate}%</span>
                </div>
                <div className="hero-progress-track">
                  <div className="hero-progress-fill fill-rose-light" style={{ width: `${occupancyRate}%` }}></div>
                </div>
              </div>

              <div className="hero-progress-box">
                <div className="progress-meta">
                  <span>Ketersediaan</span>
                  <span>{availableRate}%</span>
                </div>
                <div className="hero-progress-track">
                  <div className="hero-progress-fill fill-emerald-light" style={{ width: `${availableRate}%` }}></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="poli-right-column">
          <div className="metric-card-grid">
            <div className="metric-card-light cyan">
              <span className="metric-lbl">Total Bed</span>
              <span className="metric-val">{wardData.bed_total ?? '-'}</span>
              <span className="metric-sub">Kapasitas Keseluruhan</span>
            </div>
            <div className="metric-card-light rose">
              <span className="metric-lbl">Bed Terisi</span>
              <span className="metric-val">{wardData.bed_occupied ?? '-'}</span>
              <span className="metric-sub">Pasien Aktif</span>
            </div>
            <div className="metric-card-light emerald">
              <span className="metric-lbl">Bed Tersedia</span>
              <span className="metric-val">{wardData.bed_available ?? '-'}</span>
              <span className="metric-sub">Sisa Tempat Kosong</span>
            </div>
          </div>

          <div className="detail-panel-light">
            <div className="detail-head">
              <Stethoscope size={20} /> Ringkasan Informasi Kelas & Lokasi
            </div>
            <div className="detail-grid-light">
              <div className="detail-item-light">
                <span className="item-lbl">Nama Kelas</span>
                <span className="item-val">{wardData.class_name || wardData.name || '-'}</span>
              </div>
              <div className="detail-item-light">
                <span className="item-lbl">Kode BPJS</span>
                <span className="item-val">{wardData.bpjs_class_code || '-'}</span>
              </div>
              <div className="detail-item-light">
                <span className="item-lbl">Gedung</span>
                <span className="item-val">{wardData.building || '-'}</span>
              </div>
              <div className="detail-item-light">
                <span className="item-lbl">Lantai</span>
                <span className="item-val">{wardData.floor || '-'}</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  };

  const renderInpatientRoomView = () => {
    if (!wardData || Array.isArray(wardData)) return null;

    // Normalize patients array (either provided by SIMRS API or built from bed_total / bed_occupied)
    const rawPatients = Array.isArray(wardData.patients) && wardData.patients.length > 0
      ? wardData.patients
      : [];

    const totalBedsCount = Math.max(wardData.bed_total || 2, 1);
    const occupiedCount = wardData.bed_occupied ?? 0;

    const patientList = Array.from({ length: totalBedsCount }).map((_, idx) => {
      const existing = rawPatients[idx];
      const isOccupied = idx < occupiedCount;

      if (existing) {
        return {
          bedNumber: existing.bed_number || String(idx + 1).padStart(2, '0'),
          patientName: existing.patient_name || 'Pasien Rawat Inap',
          doctorName: existing.doctor_name || 'DPJP Spesialis',
          isOccupied: true,
        };
      }

      return {
        bedNumber: String(idx + 1).padStart(2, '0'),
        patientName: isOccupied ? (wardData.patient_name || 'Tn. Budi Santoso (Simulasi SIMRS)') : '- Kasur Kosong -',
        doctorName: isOccupied ? (wardData.doctor_name || 'dr. Bambang P, Sp.PD (DPJP)') : '-',
        isOccupied: isOccupied,
      };
    });

    return (
      <section className="poli-layout">
        {/* KOLOM KIRI (35-38%): Hero Information Card + Metric Counters */}
        <div className="poli-left-column">
          <div className="hero-card-light">
            <div className="hero-badge">
              <Building2 size={16} /> DISPLAY PINTU KAMAR
            </div>
            <h2 className="hero-title">{wardData.name}</h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '4px' }}>
              <span className="badge-pill" style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', fontSize: '12.5px', padding: '4px 12px' }}>
                Kode: {wardData.room_code || wardData.code || '-'}
              </span>
              <span className="badge-pill" style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', fontSize: '12.5px', padding: '4px 12px' }}>
                {wardData.building || 'Gedung Utama'}
              </span>
              <span className="badge-pill" style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', fontSize: '12.5px', padding: '4px 12px' }}>
                {wardData.floor || 'Lantai 1'}
              </span>
            </div>

            <div className="hero-progress-stack" style={{ marginTop: '16px' }}>
              <div className="hero-progress-box">
                <div className="progress-meta">
                  <span>Tingkat Keterisian Kamar</span>
                  <span>{occupancyRate}%</span>
                </div>
                <div className="hero-progress-track">
                  <div className="hero-progress-fill fill-rose-light" style={{ width: `${occupancyRate}%` }}></div>
                </div>
              </div>
            </div>
          </div>

          <div className="metric-card-grid">
            <div className="metric-card-light cyan">
              <span className="metric-lbl">Total Kasur</span>
              <span className="metric-val">{wardData.bed_total ?? '-'}</span>
              <span className="metric-sub">Kapasitas Kamar</span>
            </div>
            <div className="metric-card-light rose">
              <span className="metric-lbl">Kasur Terisi</span>
              <span className="metric-val">{wardData.bed_occupied ?? '-'}</span>
              <span className="metric-sub">Pasien Active</span>
            </div>
            <div className="metric-card-light emerald">
              <span className="metric-lbl">Kasur Tersedia</span>
              <span className="metric-val">{wardData.bed_available ?? '-'}</span>
              <span className="metric-sub">Siap Pakai</span>
            </div>
          </div>
        </div>

        {/* KOLOM KANAN (62-65%): Dedicated Full-Height Table Card Pasien */}
        <div className="poli-right-column">
          <div className="card table-card" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div className="table-card-head" style={{ paddingBottom: '16px', borderBottom: '1px solid var(--gray-100)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <UserCheck size={24} color="var(--blue-600)" />
                <div>
                  <h2 style={{ fontSize: '22px', fontWeight: 800 }}>Daftar Pasien di Kamar Ini</h2>
                  <span style={{ fontSize: '13px', color: 'var(--gray-500)', fontWeight: 500 }}>
                    Display informasi kamar pasien front-door
                  </span>
                </div>
              </div>
              <span className="count-pill" style={{ fontSize: '13.5px', padding: '6px 16px' }}>
                {occupiedCount} dari {totalBedsCount} Bed Terisi
              </span>
            </div>

            <div className="table-scroll" style={{ flex: 1, overflowY: 'auto', marginTop: '12px' }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: '100px' }}>No. Bed</th>
                    <th>Nama Pasien</th>
                    <th>Dokter Penanggung Jawab (DPJP)</th>
                    <th style={{ textAlign: 'right' }}>Status Kasur</th>
                  </tr>
                </thead>
                <tbody>
                  {patientList.map((item, idx) => (
                    <tr key={idx}>
                      <td className="num" style={{ fontSize: '18px' }}>Bed {item.bedNumber}</td>
                      <td className="name" style={{ fontSize: '17px', padding: '16px 18px' }}>
                        {item.isOccupied ? (
                          <span style={{ fontWeight: 700, color: 'var(--blue-900)' }}>{item.patientName}</span>
                        ) : (
                          <span style={{ color: 'var(--gray-500)', fontStyle: 'italic', fontWeight: 400 }}>{item.patientName}</span>
                        )}
                      </td>
                      <td style={{ fontSize: '15px', color: 'var(--gray-700)', fontWeight: 500 }}>
                        {item.doctorName}
                      </td>
                      <td className="status">
                        {item.isOccupied ? (
                          <span className="status-badge status-done" style={{ fontSize: '13px', padding: '6px 16px' }}>Terisi</span>
                        ) : (
                          <span className="status-badge" style={{ background: 'var(--gray-100)', color: 'var(--gray-500)', fontSize: '13px', padding: '6px 16px' }}>
                            Tersedia
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    );
  };

  const renderWardSummaryView = () => {
    if (!wardData || !Array.isArray(wardData)) return null;

    const totalBeds = wardData.reduce((acc, w) => acc + (w.bed_total || 0), 0);
    const totalOccupied = wardData.reduce((acc, w) => acc + (w.bed_occupied || 0), 0);
    const totalAvailable = wardData.reduce((acc, w) => acc + (w.bed_available || 0), 0);

    return (
      <section style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div className="summary-hero-card">
          <div>
            <h2>Ketersediaan Kamar Rawat Inap (Semua Kelas)</h2>
            <p>Monitoring sentral kapasitas dan keterisian tempat tidur seluruh kelas rawat inap RSBA.</p>
          </div>
          <div className="summary-chips-wrap">
            <div className="summary-stat-chip">
              <span>Total Bed</span>
              <strong>{totalBeds}</strong>
            </div>
            <div className="summary-stat-chip">
              <span>Terisi</span>
              <strong>{totalOccupied}</strong>
            </div>
            <div className="summary-stat-chip">
              <span>Tersedia</span>
              <strong>{totalAvailable}</strong>
            </div>
          </div>
        </div>

        <div className="card table-card">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Kelas Kamar</th>
                  <th style={{ textAlign: 'center' }}>Kapasitas</th>
                  <th style={{ textAlign: 'center' }}>Terisi</th>
                  <th style={{ textAlign: 'center' }}>Tersedia</th>
                  <th style={{ textAlign: 'right' }}>Status Keterisian</th>
                </tr>
              </thead>
              <tbody>
                {wardData.map((ward, idx) => {
                  const perc = ward.bed_total ? (ward.bed_occupied / ward.bed_total) * 100 : 0;
                  let statusText = 'Aman';
                  let statusClass = 'status-done';
                  if (perc >= 90) { statusClass = 'status-waiting'; statusText = 'Penuh'; }
                  else if (perc >= 70) { statusClass = 'status-waiting'; statusText = 'Hampir Penuh'; }

                  return (
                    <tr key={idx}>
                      <td className="name">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <BedDouble size={18} color="var(--blue-600)" />
                          <span>{ward.class_name || ward.name}</span>
                        </div>
                      </td>
                      <td className="num" style={{ textAlign: 'center' }}>{ward.bed_total}</td>
                      <td className="num" style={{ textAlign: 'center', color: 'var(--red-500)' }}>{ward.bed_occupied}</td>
                      <td className="num" style={{ textAlign: 'center', color: 'var(--green-600)' }}>{ward.bed_available}</td>
                      <td className="status">
                        <span className={`status-badge ${statusClass}`}>{statusText}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    );
  };

  const renderOperatingRoomView = () => {
    return (
      <section className="poli-layout">
        <div className="poli-left-column">
          <div className="hero-card-light">
            <div className="hero-badge">
              <Scissors size={16} /> Kamar Operasi
            </div>
            <h2 className="hero-title">{orName || targetLabel || 'Kamar Operasi'}</h2>
            <p className="hero-copy">
              Jadwal dan status pelaksanaan tindakan operasi pasien terkini.
            </p>
          </div>

          <div className="or-counter-grid">
            <div className="or-counter-card">
              <span>Menunggu</span>
              <strong>{scheduleCounts.waiting}</strong>
            </div>
            <div className="or-counter-card">
              <span>Berjalan</span>
              <strong style={{ color: 'var(--blue-600)' }}>{scheduleCounts.running}</strong>
            </div>
            <div className="or-counter-card">
              <span>Selesai</span>
              <strong style={{ color: 'var(--green-600)' }}>{scheduleCounts.done}</strong>
            </div>
          </div>
        </div>

        <div className="poli-right-column">
          <div className="card table-card">
            <div className="table-card-head">
              <h2>Jadwal Tindakan Operasi Hari Ini</h2>
              <span className="count-pill">{orData.length} Pasien</span>
            </div>

            {orData.length === 0 ? (
              <div className="empty-queue-state">
                <Clock3 size={32} />
                <p>Belum ada jadwal tindakan operasi untuk hari ini.</p>
              </div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>ID Jadwal</th>
                      <th>Nama Pasien</th>
                      <th>Rencana Mulai</th>
                      <th>Mulai Aktual</th>
                      <th style={{ textAlign: 'right' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orData.map((sch) => (
                      <tr key={sch.bpjs_schedule_id}>
                        <td className="num">{sch.bpjs_schedule_id}</td>
                        <td className="name">{sch.patient_name}</td>
                        <td>{new Date(sch.scheduled_start_at).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}</td>
                        <td>{sch.actual_start_at ? new Date(sch.actual_start_at).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-'}</td>
                        <td className="status">
                          {sch.status === 'selesai' && <span className="status-badge status-done">Selesai</span>}
                          {sch.status === 'sedang_dilaksanakan' && <span className="status-badge status-waiting">Sedang Jalan</span>}
                          {sch.status === 'menunggu' && <span className="status-badge" style={{ background: 'var(--gray-100)', color: 'var(--gray-700)' }}>Menunggu</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
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
              <Clock3 size={16} /> RSBA Information Display System
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
    <div className="screen-container light-theme">
      {renderHeader()}

      <main className="body-wrap" style={targetType === 'ward_summary' ? { gridTemplateColumns: '1fr' } : {}}>
        {errorMsg && (
          <div className="poli-closed-container" style={{ gridColumn: '1 / -1', padding: '40px' }}>
            <div className="poli-closed-card">
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <AlertCircle size={48} color="var(--red-500)" />
              </div>
              <h2 style={{ textAlign: 'center' }}>Gagal Memuat Display</h2>
              <p className="poli-closed-message" style={{ textAlign: 'center' }}>{errorMsg}</p>
            </div>
          </div>
        )}

        {!errorMsg && targetType === 'ward_class' && renderWardView()}
        {!errorMsg && targetType === 'inpatient_room' && renderInpatientRoomView()}
        {!errorMsg && targetType === 'ward_summary' && renderWardSummaryView()}
        {!errorMsg && targetType === 'operating_room' && renderOperatingRoomView()}
        {!errorMsg && targetType === 'polyclinic' && renderPolyclinicView()}

        {!errorMsg && !targetType && (
          <div className="poli-closed-container" style={{ gridColumn: '1 / -1', padding: '60px 20px' }}>
            <div className="poli-closed-card" style={{ maxWidth: '560px', margin: '0 auto' }}>
              <div className="poli-closed-icon">
                <AlertCircle size={56} color="var(--blue-600)" />
              </div>
              <span className="poli-closed-tag">Status Display: Standby</span>
              <h2>Belum Ada Mapping Monitor</h2>
              <div className="poli-closed-divider"></div>
              <p className="poli-closed-message">
                Monitor <strong>{displayId}</strong> ({deviceName}) telah terhubung tetapi belum di-mapping ke data poliklinik, rawat inap, atau ruang operasi dari Backoffice Admin.
              </p>
              <p className="poli-closed-submessage">
                Silakan buka menu <strong>Display & Mapping</strong> pada dashboard Backoffice DMS untuk menghubungkan monitor ini.
              </p>
            </div>
          </div>
        )}
      </main>

      <footer className="screen-footer">
        <div>
          <span className="footer-label">Rumah Sakit Bintang Amin • We Care, We Cure</span>
        </div>
        <div>
          <span>Terakhir diperbarui: {lastUpdated || '-'}</span>
        </div>
      </footer>
    </div>
  );
}

export default App;
