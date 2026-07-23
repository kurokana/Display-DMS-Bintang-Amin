# DMS Display - Kiosk Client STB / Smart TV Frontend

Sub-project `display` adalah aplikasi frontend Single Page Application (SPA) berbasis React murni yang dirancang untuk berjalan dalam **Kiosk Mode** pada perangkat Armbian STB / Smart TV di area kamar inap, ruang operasi, maupun ruang tunggu poliklinik RS Bintang Amin.

---

## 🛠️ Tech Stack & Dev Server

- **Framework:** React 19 + TypeScript + Vite
- **Styling:** TailwindCSS + Lucide Icons
- **Real-Time Client:** Laravel Echo (`pusher-js`)
- **Dev Port:** `http://localhost:5173`

---

## 🔑 Fitur Utama & Arsitektur React

1. **Sinkronisasi Data Real-Time (WebSocket + Fallback Polling)**:
   - Terhubung ke Laravel Reverb WebSocket Server pada `middlewaredms.test:8080`.
   - Mendengarkan channel public `displays` (update global bangsal/kamar) dan channel spesifik device `display.{ID}` (update mapping tayangan monitor).
   - Dilengkapi fallback polling otomatis setiap 15 detik jika koneksi WebSocket terputus.
2. **Periodic Heartbeat Signal**:
   - Rutin mengirimkan HTTP POST ke `/display/{displayId}/heartbeat` setiap 10 detik untuk menginformasikan status *online* dan IP Address device ke `middleware`.
3. **Pencegahan Stale Closure (`src/App.tsx`)**:
   - Menggunakan `useCallback` pada fungsi `fetchState()` dan pengelolaan handler WebSocket listener agar tidak mengalami bug *stale state closure* saat event Echo diterima.

---

## 🚀 Cara Jalankan di Development

1. **Instalasi Dependencies**:
   ```bash
   npm install
   ```
2. **Jalankan Dev Server**:
   ```bash
   npm run dev
   ```
   Aplikasi akan berjalan di `http://localhost:5173`.

3. **Build untuk Production**:
   ```bash
   npm run build
   ```
   Hasil kompilasi file static HTML/JS akan tersimpan di folder `dist/` untuk di-deploy ke Web Server Nginx.

---

## 📚 Referensi Arsitektur

- 🗺️ **[PROJECT_MAP.md](file:///d:/Intern/RSBA%20-%20Kerja%20Praktik/DMS/Tahap%201/PROJECT_MAP.md)**
- 🚀 **[HANDOVER_RUNNING_GUIDE.md](file:///d:/Intern/RSBA%20-%20Kerja%20Praktik/DMS/Tahap%201/HANDOVER_RUNNING_GUIDE.md)**
