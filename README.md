# be-laci-v4

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.3.14. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

---

## 🔌 Integrasi API Sistem Anggota

Laci menyediakan **Public API** agar aplikasi eksternal (seperti Sistem Anggota) bisa mendapatkan data wilayah dan mengirim data profil pendaftar masuk ke Laci secara otomatis.

Semua endpoint publik berada di bawah `/api/public/*` dan **wajib** menggunakan header autentikasi:
`x-api-key: <API_KEY_ANDA>`

> **Note:** API Key bisa didapatkan dengan menambahkannya manual di tabel `ApiKey` pada database.

### 1. Ambil Daftar PAC
Digunakan untuk mengisi opsi dropdown PAC pada form pendaftaran.

**Endpoint:** `GET /api/public/pacs`

**Response:**
```json
{
  "success": true,
  "data": [
    { "id": "cm0a1b2c3d...", "name": "PAC Magetan" },
    { "id": "cm0a1b2c3e...", "name": "PAC Plaosan" }
  ]
}
```

### 2. Ambil Daftar Ranting & PK berdasarkan PAC
Digunakan untuk mengisi opsi dropdown Ranting/PK setelah user memilih PAC.

**Endpoint:** `GET /api/public/wilayah?pacId=<ID_PAC_TERPILIH>`

**Response:**
```json
{
  "success": true,
  "data": {
    "ranting": [
      { "id": "cmxx...", "nama": "Ranting Selosari", "status": "AKTIF" }
    ],
    "pk": [
      { "id": "cmyy...", "nama": "PK SMAN 1 Magetan", "status": "AKTIF" }
    ]
  }
}
```

### 3. Kirim / Simpan Data Anggota Baru
Digunakan sebagai *Webhook* setelah anggota selesai mendaftar. Data akan disimpan dan otomatis terhubung ke akun Pengelola (Sekretaris Cabang/PAC).

**Endpoint:** `POST /api/public/anggota`

**Request Body (JSON):**
```json
{
  "userId": "cm0a1b2c3d...", // Wajib: ID Cabang atau PAC Pengelola
  "namaLengkap": "Budi Santoso", // Wajib
  "tingkat": "RANTING", // Wajib: "CABANG" | "PAC" | "RANTING" | "PK"
  "jabatan": "Ketua", // Opsional
  "wilayahId": "cmxx..." // Opsional: ID Ranting/PK jika memilih tingkat Ranting/PK
}
```

**Response:**
```json
{
  "success": true,
  "message": "Data Anggota berhasil disimpan di Laci dengan status PENDING",
  "data": { 
    "id": "cmyz...",
    "namaLengkap": "Budi Santoso",
    "status": "PENDING",
    "...": "..."
  }
}
```
