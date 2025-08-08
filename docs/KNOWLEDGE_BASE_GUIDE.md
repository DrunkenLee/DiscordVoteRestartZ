# Cara Menambahkan Knowledge Base File

## 📝 Overview
Anda dapat menambahkan file Markdown (`.md`) ke dalam folder `Knowledgebases/` untuk memperluas pengetahuan AI assistant. Bot akan secara otomatis memuat dan mengindeks semua file `.md` di folder tersebut.

## 📁 Struktur File
```
Knowledgebases/
├── BasicFeature.md                      ✅ (sudah ada)
├── Duplicate_Item_Detection_Tutorial.md ✅ (sudah ada)
├── Mystic_Orb_Enchantment_Tutorial.md   ✅ (sudah ada)
└── YourNewFeature.md                    📝 (bisa ditambah)
```

## ✅ Cara Menambah Knowledge Base Baru

### 1. Buat File Markdown Baru
```bash
# Buat file baru di folder Knowledgebases
touch Knowledgebases/NewFeature.md
```

### 2. Format yang Direkomendasikan
```markdown
# Judul Utama Feature

## Overview
Penjelasan singkat tentang feature ini.

### Sub Feature 1
Penjelasan detail tentang sub feature.

**Q**: Pertanyaan yang sering ditanyakan?
**A**: Jawaban yang jelas dan informatif.

### Cara Menggunakan:
1. Langkah pertama
2. Langkah kedua
3. Langkah ketiga

### Tips & Tricks:
- Tips penting untuk users
- Best practices
- Warning atau catatan khusus

### Terms & Conditions:
- Aturan penggunaan
- Batasan yang perlu diketahui
```

### 3. Restart Bot untuk Load Knowledge Baru
```bash
# Restart aplikasi agar knowledge base baru dimuat
npm start
```

## 🔍 Keywords yang Dikenali AI

### Server-Specific Terms
- `zm menu`, `rat way`, `clear corpse`, `tier system`
- `doc jessica`, `raid points`, `server points`, `hazard zone`
- `cosplay item`, `mystic orb`, `player tier`, `airdrop`
- `surat ijin dagang`, `extraction zone`, `community center`

### Gaming Terms
- `zomboid`, `zombie`, `server`, `player`, `character`
- `weapon`, `item`, `craft`, `skill`, `level`, `experience`
- `pvp`, `pve`, `raid`, `quest`, `mission`, `shop`, `store`
- `survival`, `death`, `respawn`, `vehicle`, `boat`

### Action Phrases
- `cara membuka`, `cara beli`, `cara dapat`, `bagaimana cara`
- `apa itu`, `siapa itu`, `enchant weapon`, `duplicate item`

## 📈 Tips Menulis Knowledge Base yang Efektif

### 1. Gunakan Keywords yang Jelas
```markdown
❌ Bad: "Feature ini berguna"
✅ Good: "ZM Menu berguna untuk mengakses berbagai fitur server"
```

### 2. Sertakan Q&A Format
```markdown
**Q**: Bagaimana cara membuka ZM Menu?
**A**: Tekan "Numpad 5" pada keyboard Anda.
```

### 3. Gunakan Bullet Points untuk Steps
```markdown
### Cara Membeli Cosplay:
1. Buka Server Shop (Numpad 5)
2. Pilih kategori COSPLAY
3. Bayar dengan Raid Points
4. Item akan ditambahkan ke inventory
```

### 4. Tambahkan Warning/Notes
```markdown
⚠️ **Warning**: Cosplay hanya bisa digunakan jika dibeli sendiri
📝 **Note**: Harga menggunakan Raid Points, bukan Server Points
```

## 🧪 Testing Knowledge Base Baru

### 1. Test Manual
```bash
# Run test untuk cek apakah knowledge base terload
node test/quick-test.js
```

### 2. Test di Discord
```
!ask apa itu [feature baru]?
!tanya bagaimana cara [menggunakan feature]?
```

### 3. Cek Log
```bash
# Check console output untuk konfirmasi
✅ Loaded 4 knowledge base files  # Harus bertambah
```

## 🔄 Auto-Reload Knowledge Base

Bot akan memuat ulang knowledge base ketika:
- ✅ **Restart aplikasi** - Load semua file knowledge base
- ❌ **Hot reload** - Belum support, perlu restart manual

## 📊 Monitoring & Analytics

### Cek Knowledge Base Status
```javascript
// Via Discord command (admin only)
!devhelp  // Lihat daftar command developer

// Via test script
node test/test-knowledge-integration.js
```

### Knowledge Base Statistics
```
📊 Knowledge Base Statistics:
- BasicFeature: 9 sections, 32 keywords
- Duplicate_Item_Detection_Tutorial: 34 sections, 15 keywords
- Mystic_Orb_Enchantment_Tutorial: 33 sections, 17 keywords
- YourNewFeature: X sections, Y keywords
```

## 🚀 Best Practices

### 1. Naming Convention
```
✅ Good: "PvP_System_Guide.md"
✅ Good: "Crafting_Tutorial.md"
✅ Good: "Server_Rules.md"
❌ Bad: "file1.md", "temp.md", "guide.md"
```

### 2. Content Organization
- **Satu file = Satu feature utama**
- **Gunakan heading hierarchy** (##, ###)
- **Konsisten dengan format Q&A**
- **Sertakan examples dan use cases**

### 3. Language Support
```markdown
# Support Indonesian & English
**Q**: Bagaimana cara craft weapon?
**A**: How to craft weapon: Right-click > Craft > Weapons

**Q**: How to craft weapon?
**A**: Cara craft weapon: Klik kanan > Craft > Weapons
```

## 🔧 Troubleshooting

### Knowledge Tidak Terdeteksi
1. **Cek format file** - Harus `.md`
2. **Cek lokasi** - Harus di folder `Knowledgebases/`
3. **Restart bot** - Knowledge dimuat saat startup
4. **Cek keywords** - Pastikan menggunakan keywords yang relevant

### Response Tidak Akurat
1. **Perbaiki keywords** - Tambah synonyms dan variations
2. **Improve content structure** - Gunakan headings yang jelas
3. **Add more examples** - Sertakan berbagai skenario penggunaan

### Performance Issues
1. **File size** - Batasi maksimal 50KB per file
2. **Number of files** - Maksimal 20 files untuk performa optimal
3. **Content complexity** - Hindari nested structure yang terlalu dalam

Dengan sistem ini, Anda dapat terus menambah dan update knowledge base sesuai dengan perkembangan server dan feedback dari players!
