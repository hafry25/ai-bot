# AI Bot

Bot grid spot Binance berbasis Node.js dengan konfigurasi lewat `.env`.
Bot ini mendukung:

- mode `live`, `testnet`, atau `demo`
- grid arithmetic atau geometric
- range manual atau otomatis
- trailing range
- validasi AI opsional via Gemini
- notifikasi opsional via Fonnte

## Kebutuhan

- Node.js 18+ disarankan
- Akun Binance Spot
- API key dan secret Binance

## Instalasi

```bash
npm install
```

## Setup

1. Salin `env.example` menjadi `.env`
2. Isi `EXCHANGE_API_KEY` dan `EXCHANGE_SECRET`
3. Atur `EXCHANGE_MODE` sesuai environment yang dipakai
4. Sesuaikan `SYMBOLS`, `GRID_COUNT`, dan parameter range/grid lainnya

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

Atau:

```bash
node index.js
```

## Konfigurasi Penting

- `EXCHANGE_MODE`: `live`, `testnet`, atau `demo`
- `SYMBOLS`: daftar pair dipisah koma, misalnya `BTC/USDT,ETH/USDT`
- `GRID_LOWER_PRICE` dan `GRID_UPPER_PRICE`: range manual
- `GRID_RANGE_PCT`: dipakai kalau range manual tidak diisi
- `GRID_ORDER_SIZE_USDT` atau `GRID_TOTAL_INVESTMENT_USDT`: pilih salah satu untuk ukuran modal
- `AI_VALIDATION_ENABLED`: aktifkan jika ingin bot meminta validasi Gemini
- `LEARNING_MEMORY_ENABLED`: aktifkan jika ingin bot menyimpan dan memakai histori keputusan
- `FONNTE_ENABLED`: aktifkan jika ingin notifikasi WhatsApp via Fonnte

Learning memory memakai batas profit minimal otomatis dari ukuran order grid, jadi tidak ada env khusus untuk threshold profit.

## File State

Bot menyimpan state lokal di file seperti:

- `grid-state-spot.json`
- `grid-state-spot.json.lock`
- `bot-paused.flag`

File-file ini sudah diabaikan lewat `.gitignore`.

## Catatan

- Jangan jalankan di akun live sebelum dites di `testnet` atau `demo`.
- Jika `AI_VALIDATION_ENABLED=true`, isi `GEMINI_API_KEY`.
- Jika `FONNTE_ENABLED=true`, isi `FONNTE_TOKEN` dan `FONNTE_TARGET`.

## Test

```bash
npm test
```
