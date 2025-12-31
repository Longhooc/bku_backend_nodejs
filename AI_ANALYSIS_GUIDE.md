# Hướng Dẫn Sử Dụng Tính Năng Phân Tích AI

## 🎯 Tính Năng

Nút **"Phân Tích AI"** cho phép bạn:
1. Chọn một node/thiết bị
2. Chỉ định số mẫu dữ liệu cần phân tích (1-100)
3. Gửi dữ liệu đến Google Gemini AI để phân tích rung động và dự đoán lỗi máy

## 🔧 Cấu Hình API Key

### Bước 1: Lấy Google Gemini API Key (MIỄN PHÍ)

1. Truy cập: https://makersuite.google.com/app/apikey
2. Đăng nhập bằng tài khoản Google
3. Click **"Create API Key"**
4. Copy API key

### Bước 2: Cập Nhật API Key trong Code

Mở file `public/ai-analysis.js` và tìm dòng:

```javascript
const geminiApiKey = 'YOUR_GEMINI_API_KEY'; // ← BẠN CẦN THAY ĐỔI KEY NÀY
```

Thay `YOUR_GEMINI_API_KEY` bằng API key bạn vừa tạo:

```javascript
const geminiApiKey = 'AIzaSyD...your-actual-key-here...';
```

### Bước 3: Lưu và Restart Server

```bash
# Ctrl+C để dừng server
# Chạy lại:
sudo node server.js
```

### Bước 4: Truy Cập Web Interface

Mở trình duyệt: `http://localhost:3001` hoặc `https://axithcl.sytes.net`

---

## 📊 Cách Sử Dụng

1. **Scroll xuống phần "🤖 Phân Tích AI"**
2. **Chọn thiết bị** từ dropdown
3. **Nhập số mẫu** (mặc định: 10, max: 100)
4. **Click "🚀 Phân Tích Ngay"**
5. **Đợi kết quả** (10-30 giây)

### Kết Quả Hiển Thị:

AI sẽ phân tích dựa trên:
- **vrms**: Giá trị RMS của rung động
- **kurtosis**: Hệ số Kurtosis (phát hiện shock/impulse)
- **peak**: Giá trị peak trong FFT
- **fft**: Dữ liệu phổ tần số FFT

AI sẽ trả về:
- Đánh giá tình trạng máy
- Dự đoán nguyên nhân lỗi
- Khuyến nghị hành động

---

## 🔍 Format Dữ Liệu Gửi đến AI

```json
[
  {
    "node": 43,
    "x": -0.4,
    "y": 0.28,
    "z": 10.1,
    "vrms": 10.112,
    "kurtosis": 2.5,
    "peak": 15.6,
    "fft": "596.0,533.8,524.3,...",
    "timestamp": "2025-12-29T23:42:01.000Z",
    "rdate": "2025-12-29"
  },
  ...
]
```

---

## 🎓 Giải Thích Các Chỉ Số

### VRMS (Root Mean Square)
- **Normal**: < 2.5 m/s²
- **Warning**: 2.5 - 7.0 m/s²
- **Critical**: > 7.0 m/s²

### Kurtosis
- **Normal**: 3.0 (phân phối chuẩn)
- **High** (> 5): Có shock/impulse bất thường
- **Low** (< 2): Thiếu biến động

### Peak
- Giá trị cao nhất trong phổ FFT
- Phát hiện tần số dominant
- So sánh với baseline

### FFT (Fast Fourier Transform)
- Phổ tần số của rung động
- Phát hiện tần số cộng hưởng
- Chẩn đoán lỗi bearing, unbalance, misalignment

---

## 🛠️ Troubleshooting

### Lỗi: "API key không hợp lệ"
- Kiểm tra API key đã copy đúng
- Đảm bảo không có khoảng trắng thừa
- Tạo API key mới nếu cần

### Lỗi: "Không có dữ liệu"
- Chọn device khác
- Đợi thiết bị gửi dữ liệu
- Giảm số mẫu yêu cầu

### Lỗi: "Network error"
- Kiểm tra kết nối internet
- Kiểm tra firewall
- Thử lại sau ít phút

---

## 💡 Tips

1. **Tăng độ chính xác**: Sử dụng 20-50 mẫu thay vì 10
2. **Phân tích nhanh**: Dùng 5-10 mẫu để test
3. **So sánh**: Chạy phân tích nhiều lần để thấy xu hướng
4. **Lưu kết quả**: Copy/paste kết quả AI vào file để so sánh

---

## 📝 API Endpoints

### GET `/api/analyze-vibration`

**Parameters:**
- `device_id` (required): ID của thiết bị
- `limit` (optional, default=10): Số mẫu cần lấy

**Response:**
```json
[
  {
    "node": 43,
    "x": -0.4,
    "y": 0.28,
    "z": 10.1,
    "vrms": 10.112,
    "kurtosis": 2.5,
    "peak": 15.6,
    "fft": "596.0,533.8,...",
    "timestamp": "2025-12-29T23:42:01.000Z",
    "rdate": "2025-12-29"
  }
]
```

---

## 🎉 Hoàn Thành!

Bạn đã cấu hình xong tính năng phân tích AI! 

Nếu gặp vấn đề, kiểm tra:
1. Console log trong browser (F12 → Console)
2. Server logs
3. API key hợp lệ

**Chúc bạn thành công!** 🚀
