# Binance Spot Grid Bot

Bot grid spot Binance berbasis Node.js. Konfigurasi dibaca dari `.env`, state disimpan lokal, dan bot memakai lock file agar tidak berjalan ganda.

## Fitur

- Mode exchange `live`, `testnet`, atau `demo` (`demo` dipetakan ke `testnet`)
- Multi-symbol, misalnya `BTC/USDT,ETH/USDT`
- Grid `ARITHMETIC` atau `GEOMETRIC`
- Range manual, auto range, stale range auto reset, dan trailing range
- Batas modal per order atau total investasi grid
- Refill order setelah fill, cancel order out-of-range, dan post-only maker order
- Stop trading, kill switch file, stop-loss, dan take-profit
- Validasi AI opsional via Gemini
- Learning memory opsional
- Notifikasi WhatsApp opsional via Fonnte

## Kebutuhan

- Node.js 18+
- Akun Binance Spot
- API key dan secret Binance Spot

## Instalasi

```bash
npm install
```

## Setup

1. Salin `env.example` menjadi `.env`.
2. Isi `EXCHANGE_API_KEY` dan `EXCHANGE_SECRET`.
3. Mulai dari `EXCHANGE_MODE=testnet` untuk uji coba.
4. Sesuaikan `SYMBOLS`, `GRID_COUNT`, `GRID_ORDER_SIZE_USDT`, dan pengaturan range.

Contoh minimal:

```env
EXCHANGE_API_KEY=your_binance_api_key_here
EXCHANGE_SECRET=your_binance_secret_here
EXCHANGE_MODE=testnet
SYMBOLS=BTC/USDT
GRID_ORDER_SIZE_USDT=20
```

## Menjalankan

```bash
npm start
```

Atau langsung:

```bash
node index.js
```

## Konfigurasi Utama

- `EXCHANGE_MODE`: `live`, `testnet`, atau `demo`.
- `SYMBOLS`: pair dipisah koma, contoh `BTC/USDT,ETH/USDT`.
- `INTERVAL_MINUTES`: jarak antar siklus sinkronisasi.
- `GRID_MODE`: `ARITHMETIC` atau `GEOMETRIC`.
- `GRID_COUNT`: jumlah level grid, minimal 2.
- `GRID_LOWER_PRICE` dan `GRID_UPPER_PRICE`: isi keduanya untuk range manual.
- `GRID_RANGE_PCT`: auto range `+/-` dari harga saat range dibuat.
- `GRID_RESET_RANGE_ON_START`: paksa hitung ulang auto range saat start.
- `GRID_STALE_RANGE_DEVIATION_PCT`: ambang deteksi range lama yang terlalu jauh dari harga.
- `GRID_STALE_RANGE_AUTO_RESET`: otomatis reset stale range.

## Modal dan Order

- `GRID_ORDER_SIZE_USDT`: ukuran order per grid.
- `GRID_TOTAL_INVESTMENT_USDT`: jika lebih dari 0, menjadi batas total modal dan mengambil prioritas.
- `GRID_MAX_ACTIVE_BUY_ORDERS` dan `GRID_MAX_ACTIVE_SELL_ORDERS`: batas order aktif per sisi.
- `GRID_RECREATE_ON_START`: cancel dan buat ulang grid saat bot start.
- `GRID_CANCEL_OUT_OF_RANGE`: cancel order yang sudah keluar range.
- `GRID_REFILL_ON_FILLED`: buat order pengganti setelah fill.
- `GRID_POST_ONLY`: gunakan maker/post-only order jika exchange mendukung.

## Trailing Range

- `GRID_TRAILING_RANGE_ENABLED`: default global untuk trailing up/down.
- `GRID_TRAILING_UP_ENABLED`: aktifkan range mengikuti kenaikan harga.
- `GRID_TRAILING_UP_COOLDOWN_MINUTES`: jeda trailing up.
- `GRID_TRAILING_DOWN_ENABLED`: aktifkan range mengikuti penurunan harga.
- `GRID_TRAILING_DOWN_COOLDOWN_MINUTES`: jeda trailing down.

## Safety

- `STOP_TRADING=true`: bot tidak menempatkan order baru.
- `KILL_SWITCH_ENABLED=true`: bot pause jika file `KILL_SWITCH_FILE` ada.
- `GRID_STOP_LOSS_PRICE`: cancel grid dan stop order baru jika harga <= nilai ini.
- `GRID_TAKE_PROFIT_PRICE`: cancel grid dan stop order baru jika harga >= nilai ini.

## AI, Memory, dan Alert

- `AI_VALIDATION_ENABLED=true`: aktifkan validasi Gemini. Wajib isi `GEMINI_API_KEY`.
- `AI_MIN_CONFIDENCE`: confidence minimal agar keputusan AI dianggap valid.
- `LEARNING_MEMORY_ENABLED=true`: simpan dan pakai histori hasil trading lokal.
- `FONNTE_ENABLED=true`: aktifkan alert WhatsApp. Wajib isi `FONNTE_TOKEN` dan `FONNTE_TARGET`.

Learning memory memakai data profit aktual dari fill order dan tidak memakai env threshold profit khusus.

## File Lokal

Default file yang dibuat bot:

- `grid-state-spot.json`
- `grid-state-spot.json.lock`
- `learning-memory.json`
- `bot-paused.flag`

File runtime tersebut sudah diabaikan lewat `.gitignore`.

## Test

```bash
npm test
```

## Catatan

Selalu uji di `testnet` sebelum memakai mode `live`. Pastikan saldo, minimum notional exchange, dan ukuran order sesuai pair yang dipakai.
