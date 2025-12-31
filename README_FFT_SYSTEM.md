# Hệ Thống Thu Thập FFT Khi Vượt Ngưỡng

## 📚 Tài Liệu Đã Tạo

Hệ thống bao gồm 3 file tài liệu chính:

### 1. **FFT_TRIGGER_SUMMARY.md** ⭐ BẮT ĐẦU TỪ ĐÂY
   - Tóm tắt ngắn gọn luồng hoạt động
   - Giải thích từng bước request/response
   - Checklist triển khai
   - **Đọc file này trước!**

### 2. **GATEWAY_IMPLEMENTATION_GUIDE.md** 📖 CHI TIẾT
   - Hướng dẫn đầy đủ code Gateway
   - Giải thích từng phần code
   - Bao gồm cả code Node và Server
   - Debugging tips
   - **Tham khảo khi code!**

### 3. **gateway_template.ino** 💻 TEMPLATE MẪU
   - Code template đơn giản, sẵn sàng dùng
   - Chỉ cần sửa WiFi credentials và Server URL
   - Có comments chi tiết
   - **Copy và sửa để dùng!**

---

## 🎯 Kiến Trúc Tổng Quan

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│             │ ESP-NOW │             │  HTTP   │             │
│    NODE     │────────>│   GATEWAY   │────────>│   SERVER    │
│   (ESP32)   │<────────│   (ESP32)   │<────────│  (Node.js)  │
│             │ Command │             │Response │             │
└─────────────┘         └─────────────┘         └─────────────┘
```

### Luồng Hoạt Động
1. Node gửi sensor data → Gateway (ESP-NOW)
2. Gateway forward → Server (HTTP POST)
3. Server phân tích, nếu vượt ngưỡng trả về `trigger_fft: true`
4. Gateway nhận response, gửi FFT command → Node (ESP-NOW)
5. Node thu thập FFT → Gateway → Server

---

## 🚀 Hướng Dẫn Nhanh

### Bước 1: Cập Nhật Server (Đã Hoàn Thành ✅)
Server `server.js` đã được cập nhật:
- ✅ Response có field `trigger_fft`
- ✅ Endpoint `/api/fft-data` để nhận FFT
- ✅ Table `fft_analysis` trong database

**Không cần làm gì thêm phía server!**

### Bước 2: Code Gateway
1. Mở file `gateway_template.ino`
2. Sửa 3 dòng:
   ```cpp
   const char* WIFI_SSID = "YOUR_WIFI_SSID";      // WiFi name
   const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";  // WiFi password
   const char* SERVER_URL = "http://192.168.1.100:3001/api/sensor-data";  // Server IP
   ```
3. Upload lên ESP32 Gateway

### Bước 3: Cài Đặt Thư Viện Arduino
Cần cài các thư viện sau trong Arduino IDE:
- **WiFi** (built-in ESP32)
- **HTTPClient** (built-in ESP32)
- **esp_now** (built-in ESP32)
- **ArduinoJson** (Library Manager → tìm "ArduinoJson" by Benoit Blanchon)

### Bước 4: Code Node (ESP32)
Node cần:
1. Gửi `SensorDataPacket` định kỳ qua ESP-NOW
2. Nhận `CommandPacket` từ Gateway
3. Khi nhận `CMD_START_FFT`, thu thập và gửi FFT data

**Xem GATEWAY_IMPLEMENTATION_GUIDE.md phần 7 cho code Node đầy đủ**

---

## 📊 Response Format Từ Server

### Response Bình Thường
```json
{
    "success": true,
    "vibration_magnitude": 9.83,
    "is_abnormal": false,
    "severity": "LOW",
    "trigger_fft": false
}
```

### Response Khi Cần FFT
```json
{
    "success": true,
    "vibration_magnitude": 15.6,
    "is_abnormal": true,
    "severity": "HIGH",
    "trigger_fft": true     ← Gateway phải check flag này!
}
```

**Gateway kiểm tra:**
```cpp
if (responseDoc["trigger_fft"] == true) {
    sendFFTCommand(data.device_id);
}
```

---

## 🔧 Cấu Hình Ngưỡng

### Server Trigger FFT Khi:
- ✅ `is_abnormal = true`
- ✅ VÀ `severity != "LOW"`

Nghĩa là severity phải là: **MEDIUM, HIGH, hoặc CRITICAL**

### Công Thức:
```
Baseline = Trung bình 10 mẫu gần nhất
Threshold = Baseline × 1.5
is_abnormal = vibration_magnitude > Threshold

Severity:
- ratio > 3.0 → CRITICAL
- ratio > 2.0 → HIGH
- ratio > 1.5 → MEDIUM
- ratio <= 1.5 → LOW
```

### Điều Chỉnh Ngưỡng
Nếu muốn thay đổi, sửa trong `server.js`:
```javascript
// Line ~158
const threshold = deviceBaseline.baseline * 1.5;  // ← Thay 1.5 thành giá trị khác

// Line ~154-160
calculateSeverity(currentMagnitude, baseline) {
    const ratio = currentMagnitude / baseline;
    if (ratio > 3.0) return 'CRITICAL';  // ← Thay đổi ngưỡng
    if (ratio > 2.0) return 'HIGH';
    if (ratio > 1.5) return 'MEDIUM';
    return 'LOW';
}
```

---

## 🧪 Testing

### 1. Test WiFi Connection
```
Serial Monitor nên hiển thị:
✅ WiFi Connected!
IP: 192.168.1.xxx
```

### 2. Test ESP-NOW Receive
```
Khi Node gửi data:
📡 Received from XX:XX:XX:XX:XX:XX (32 bytes)
📊 Processing Sensor Data:
  Device: NODE_001
  Accel: X=0.50 Y=1.20 Z=9.80
```

### 3. Test HTTP POST
```
📤 Sending to server...
✅ Server Response (HTTP 200):
{"success":true,"vibration_magnitude":9.83,...}
```

### 4. Test FFT Trigger
```
Khi vượt ngưỡng:
⚠️ ═══════════════════════════════
⚠️  TRIGGER FFT COLLECTION!
⚠️ ═══════════════════════════════
📤 Sending FFT command to NODE_001...
✅ FFT command sent!
```

---

## 🐛 Troubleshooting

### Gateway không kết nối WiFi
- Kiểm tra SSID và password
- Đảm bảo ESP32 trong vùng phủ sóng
- Thử `WiFi.mode(WIFI_STA)` nếu không cần ESP-NOW

### HTTP POST thất bại
- Ping server IP từ máy tính cùng mạng
- Kiểm tra firewall của server
- Đảm bảo server đang chạy (port 3001)
- Test với Postman trước

### ESP-NOW không nhận được data từ Node
- Kiểm tra Node có gửi đúng cấu trúc `SensorDataPacket` không
- Gateway và Node phải cùng WiFi channel
- Kiểm tra khoảng cách giữa Node và Gateway

### Response không có `trigger_fft`
- Kiểm tra server.js đã được restart chưa
- Test bằng cách gửi POST với vibration lớn qua Postman
- Xem log server có hiển thị `is_abnormal: true` không

---

## 📁 Cấu Trúc File

```
d:\datt\datt\
│
├── server.js                          # Server (đã update)
├── vibration_data.db                  # Database
│
├── README_FFT_SYSTEM.md              # File này - Tổng quan
├── FFT_TRIGGER_SUMMARY.md            # Tóm tắt ngắn
├── GATEWAY_IMPLEMENTATION_GUIDE.md   # Hướng dẫn chi tiết
└── gateway_template.ino              # Template code Gateway
```

---

## 🎓 Học Thêm

### Về ESP-NOW
- [ESP-NOW Documentation](https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-reference/network/esp_now.html)
- Giới hạn: 250 bytes/packet
- Tốc độ: ~250kbps
- Range: 100-200m (không vật cản)

### Về FFT
- Cần thư viện: `arduinoFFT`
- Sample rate khuyến nghị: 1000Hz
- Số mẫu: 256, 512, hoặc 1024 (power of 2)
- Window function: Hamming hoặc Hann

### Về HTTP Client (ESP32)
- Timeout mặc định: 5000ms
- Max payload: ~4KB (tùy RAM)
- Hỗ trợ HTTPS (cần certificate)

---

## 📞 Hỗ Trợ

Nếu gặp vấn đề:
1. Kiểm tra Serial Monitor của Gateway
2. Kiểm tra log output của Server (terminal chạy Node.js)
3. Xem phần Troubleshooting ở trên
4. Đọc GATEWAY_IMPLEMENTATION_GUIDE.md phần Debug

---

## ✅ Checklist Triển Khai Cuối Cùng

- [ ] Server đã update và đang chạy
- [ ] Gateway kết nối WiFi thành công
- [ ] Gateway nhận được data từ Node
- [ ] Gateway gửi HTTP POST thành công
- [ ] Server trả về response có `trigger_fft`
- [ ] Gateway parse được response JSON
- [ ] Gateway gửi FFT command khi trigger
- [ ] Node nhận được FFT command
- [ ] Node thực hiện FFT và gửi về
- [ ] Server nhận và lưu FFT data

**Khi tất cả checklist ✅ → Hệ thống hoạt động hoàn hảo!** 🎉

---

## 📝 Notes

- Server chỉ giao tiếp với Gateway qua HTTP POST
- Gateway là "cầu nối" giữa Node (ESP-NOW) và Server (HTTP)
- Node không cần kết nối WiFi, chỉ cần ESP-NOW
- FFT chỉ được kích hoạt khi **thực sự cần thiết** để tiết kiệm pin

**Chúc bạn thành công!** 🚀
