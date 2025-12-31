# Tóm Tắt: Hệ Thống FFT Trigger

## 🎯 Mục Tiêu
Khi giá trị rung động từ Node vượt ngưỡng → Server trigger Gateway → Gateway yêu cầu Node thu thập FFT

---

## 📊 Luồng Dữ Liệu

```
┌─────────┐         ┌──────────┐         ┌─────────┐
│  NODE   │────1───>│ GATEWAY  │────2───>│ SERVER  │
│ (ESP32) │<───4────│ (ESP32)  │<───3────│(Node.js)│
└─────────┘         └──────────┘         └─────────┘
```

### Bước 1: Node → Gateway (ESP-NOW)
**Gửi:** Dữ liệu cảm biến thường xuyên
```cpp
SensorDataPacket {
    device_id: "NODE_001",
    accel_x: 0.5,
    accel_y: 1.2,
    accel_z: 9.8,
    battery_voltage_mv: 3300
}
```

### Bước 2: Gateway → Server (HTTP POST)
**URL:** `http://YOUR_SERVER:3001/api/sensor-data`
```json
{
    "device_id": "NODE_001",
    "accel_x": 0.5,
    "accel_y": 1.2,
    "accel_z": 9.8,
    "battery_voltage_mv": 3300,
    "gateway_id": "GATEWAY_001"
}
```

### Bước 3: Server → Gateway (HTTP Response)
**Response khi BÌNH THƯỜNG:**
```json
{
    "success": true,
    "vibration_magnitude": 9.83,
    "is_abnormal": false,
    "severity": "LOW",
    "trigger_fft": false
}
```

**Response khi VƯỢT NGƯỠNG:**
```json
{
    "success": true,
    "vibration_magnitude": 15.6,
    "is_abnormal": true,
    "severity": "HIGH",
    "trigger_fft": true     ← ★ QUAN TRỌNG!
}
```

### Bước 4: Gateway → Node (ESP-NOW)
**Gửi:** Lệnh thu thập FFT
```cpp
CommandPacket {
    command_type: CMD_START_FFT,  // 0x01
    sample_count: 512,
    sample_rate: 1000
}
```

---

## 💻 Code Gateway - Phần Quan Trọng Nhất

### 1. Nhận Data từ Node và Gửi đến Server
```cpp
void handleSensorData(SensorDataPacket &data) {
    // Gửi dữ liệu đến server qua HTTP POST
    bool triggerFFT = sendDataToServer(data);
    
    // Nếu server yêu cầu FFT
    if (triggerFFT) {
        sendFFTCommand(data.device_id);
    }
}

bool sendDataToServer(SensorDataPacket &data) {
    HTTPClient http;
    http.begin("http://YOUR_SERVER:3001/api/sensor-data");
    http.addHeader("Content-Type", "application/json");
    
    // Tạo JSON
    StaticJsonDocument<512> doc;
    doc["device_id"] = data.device_id;
    doc["accel_x"] = data.accel_x;
    doc["accel_y"] = data.accel_y;
    doc["accel_z"] = data.accel_z;
    doc["battery_voltage_mv"] = data.battery_voltage_mv;
    doc["gateway_id"] = "GATEWAY_001";
    
    String payload;
    serializeJson(doc, payload);
    
    // Gửi POST
    int httpCode = http.POST(payload);
    
    bool triggerFFT = false;
    if (httpCode == 200) {
        // Parse response
        String response = http.getString();
        StaticJsonDocument<256> responseDoc;
        deserializeJson(responseDoc, response);
        
        // Kiểm tra trigger_fft flag
        if (responseDoc["trigger_fft"] == true) {
            triggerFFT = true;
        }
    }
    
    http.end();
    return triggerFFT;
}
```

### 2. Gửi Lệnh FFT đến Node
```cpp
void sendFFTCommand(const char* device_id) {
    // Tìm MAC address của node
    uint8_t* nodeMac = findNodeMAC(device_id);
    
    // Tạo command packet
    CommandPacket cmd;
    cmd.command_type = CMD_START_FFT;
    cmd.sample_count = 512;
    cmd.sample_rate = 1000;
    
    // Gửi qua ESP-NOW
    esp_now_send(nodeMac, (uint8_t*)&cmd, sizeof(cmd));
}
```

---

## 🔧 Cấu Hình Server

### Ngưỡng Trigger FFT
Server sẽ set `trigger_fft = true` khi:
- `is_abnormal = true` 
- VÀ `severity != "LOW"`

Tức là: **MEDIUM, HIGH, hoặc CRITICAL**

### Công Thức Tính
- **Baseline**: Trung bình 10 mẫu gần nhất
- **Threshold**: Baseline × 1.5
- **Vượt ngưỡng**: `vibration_magnitude > threshold`

```javascript
// Trong server.js
res.json({
    success: true,
    vibration_magnitude: vibrationMagnitude,
    is_abnormal: analysis.isAbnormal,
    severity: analysis.severity,
    trigger_fft: analysis.isAbnormal && analysis.severity !== 'LOW'
});
```

---

## 📈 Sau Khi Node Thu Thập FFT

### Node → Gateway → Server
```
Node: Thu thập 512 mẫu FFT
      ↓
      Chia thành 8 packets (64 samples/packet)
      ↓
Gateway: Nhận và reassemble
      ↓
      Gửi full FFT data đến Server
      ↓
Server: POST /api/fft-data
      ↓
      Phân tích dominant frequency
      ↓
      Lưu vào database table fft_analysis
```

---

## ✅ Checklist Triển Khai Gateway

### Hardware
- [ ] ESP32 Gateway có WiFi + ESP-NOW
- [ ] Kết nối internet đến Server

### Cấu hình
- [ ] Sửa `YOUR_WIFI_SSID` và `YOUR_WIFI_PASSWORD`
- [ ] Sửa `YOUR_SERVER_IP` và port `3001`
- [ ] Set `GATEWAY_ID` unique cho mỗi gateway

### Test
- [ ] Gateway nhận được data từ Node (Serial log)
- [ ] Gateway gửi HTTP POST thành công (HTTP 200)
- [ ] Gateway parse được response JSON
- [ ] Gateway gửi được FFT command khi trigger
- [ ] Node nhận được FFT command và bắt đầu thu thập

---

## 🐛 Debug

### Kiểm tra HTTP Response
```cpp
Serial.println("HTTP Response: " + http.getString());
```

### Kiểm tra Trigger
```cpp
if (responseDoc["trigger_fft"] == true) {
    Serial.println("⚠️ FFT TRIGGERED!");
}
```

### Monitor ESP-NOW
```cpp
void onDataSent(const uint8_t *mac, esp_now_send_status_t status) {
    Serial.printf("Send Status: %s\n", 
        status == ESP_NOW_SEND_SUCCESS ? "✅ OK" : "❌ FAIL");
}
```

---

## 📝 File Tham Khảo

1. **GATEWAY_IMPLEMENTATION_GUIDE.md** - Hướng dẫn chi tiết đầy đủ
2. **server.js** - Server code (đã update)
   - Endpoint: `/api/sensor-data` (nhận sensor data)
   - Endpoint: `/api/fft-data` (nhận FFT results)

---

## 🎯 Kết Luận

**Điều quan trọng nhất:** Gateway phải check field `trigger_fft` trong response từ server. Nếu `true`, gửi lệnh FFT command đến Node qua ESP-NOW.

```cpp
// CORE LOGIC
if (responseDoc["trigger_fft"] == true) {
    sendFFTCommand(data.device_id);
}
```
