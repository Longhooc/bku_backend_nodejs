# Hướng Dẫn Code Gateway - Hệ Thống Thu Thập Dữ Liệu Rung Động với FFT

## 📋 Tổng Quan Kiến Trúc

```
[Node ESP32] --ESP-NOW--> [Gateway] --HTTP POST--> [Server]
                              ↑                         |
                              |                         |
                              +----FFT Request---------+
```

### Luồng Hoạt Động:
1. **Node** gửi dữ liệu rung động liên tục qua ESP-NOW đến Gateway
2. **Gateway** forward dữ liệu đến Server qua HTTP POST
3. **Server** phân tích dữ liệu, nếu phát hiện vượt ngưỡng:
   - Server trả về response với `trigger_fft: true`
4. **Gateway** nhận response từ server:
   - Nếu `trigger_fft == true`, gửi lệnh đến Node qua ESP-NOW
5. **Node** nhận lệnh, bắt đầu thu thập dữ liệu FFT và gửi về

---

## 🔧 PHẦN 1: Cấu Hình Cơ Bản Gateway (ESP32)

### 1.1. Thư Viện Cần Thiết

```cpp
#include <WiFi.h>
#include <HTTPClient.h>
#include <esp_now.h>
#include <ArduinoJson.h>
```

### 1.2. Cấu Hình WiFi và Server

```cpp
// WiFi Configuration
const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

// Server Configuration
const char* serverUrl = "http://YOUR_SERVER_IP:3001/api/sensor-data";
// Hoặc HTTPS: "https://axithcl.sytes.net:3000/api/sensor-data"

// Gateway Configuration
#define GATEWAY_ID "GATEWAY_001"
#define MAX_NODES 10
```

### 1.3. Cấu Trúc Dữ Liệu ESP-NOW

```cpp
// Cấu trúc dữ liệu nhận từ Node (định kỳ)
typedef struct {
    char device_id[20];
    float accel_x;
    float accel_y;
    float accel_z;
    uint32_t timestamp;
    uint16_t battery_voltage_mv;
} SensorDataPacket;

// Cấu trúc dữ liệu FFT từ Node (khi được trigger)
typedef struct {
    char device_id[20];
    uint8_t packet_number;     // Số thứ tự packet (0-N)
    uint8_t total_packets;     // Tổng số packet
    float fft_data[64];        // Dữ liệu FFT (có thể chia nhỏ)
    uint32_t timestamp;
} FFTDataPacket;

// Cấu trúc lệnh gửi đến Node
typedef struct {
    uint8_t command_type;      // 0x01: START_FFT, 0x02: STOP_FFT
    uint16_t sample_count;     // Số mẫu cần thu thập
    uint16_t sample_rate;      // Tần số lấy mẫu (Hz)
} CommandPacket;

// Command types
#define CMD_START_FFT 0x01
#define CMD_STOP_FFT  0x02
#define CMD_HEARTBEAT 0x03
```

---

## 🔧 PHẦN 2: Khởi Tạo ESP-NOW và WiFi

### 2.1. WiFi Setup

```cpp
void setupWiFi() {
    WiFi.mode(WIFI_AP_STA);  // AP + STA mode để vừa ESP-NOW vừa WiFi
    
    WiFi.begin(ssid, password);
    Serial.print("Connecting to WiFi");
    
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 20) {
        delay(500);
        Serial.print(".");
        attempts++;
    }
    
    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\nWiFi Connected!");
        Serial.print("IP Address: ");
        Serial.println(WiFi.localIP());
    } else {
        Serial.println("\nWiFi Connection Failed!");
    }
}
```

### 2.2. ESP-NOW Setup

```cpp
// Callback khi nhận dữ liệu từ Node
void onDataReceive(const uint8_t *mac_addr, const uint8_t *data, int data_len) {
    char macStr[18];
    snprintf(macStr, sizeof(macStr), "%02X:%02X:%02X:%02X:%02X:%02X",
             mac_addr[0], mac_addr[1], mac_addr[2], 
             mac_addr[3], mac_addr[4], mac_addr[5]);
    
    Serial.printf("📡 Received from %s, size: %d\n", macStr, data_len);
    
    // Kiểm tra loại packet
    if (data_len == sizeof(SensorDataPacket)) {
        SensorDataPacket sensorData;
        memcpy(&sensorData, data, sizeof(sensorData));
        handleSensorData(sensorData);
    } 
    else if (data_len == sizeof(FFTDataPacket)) {
        FFTDataPacket fftData;
        memcpy(&fftData, data, sizeof(fftData));
        handleFFTData(fftData);
    }
}

// Callback khi gửi dữ liệu thành công/thất bại
void onDataSent(const uint8_t *mac_addr, esp_now_send_status_t status) {
    Serial.print("📤 Send Status: ");
    Serial.println(status == ESP_NOW_SEND_SUCCESS ? "Success" : "Fail");
}

void setupESPNow() {
    if (esp_now_init() != ESP_OK) {
        Serial.println("❌ ESP-NOW Init Failed");
        return;
    }
    
    Serial.println("✅ ESP-NOW Initialized");
    
    // Register callbacks
    esp_now_register_recv_cb(onDataReceive);
    esp_now_register_send_cb(onDataSent);
}
```

---

## 🔧 PHẦN 3: Xử Lý Dữ Liệu Cảm Biến và Gửi HTTP POST

### 3.1. Handler cho Sensor Data

```cpp
void handleSensorData(SensorDataPacket &data) {
    Serial.println("📊 Processing Sensor Data...");
    Serial.printf("Device: %s\n", data.device_id);
    Serial.printf("Accel: X=%.3f, Y=%.3f, Z=%.3f\n", 
                  data.accel_x, data.accel_y, data.accel_z);
    Serial.printf("Battery: %d mV\n", data.battery_voltage_mv);
    
    // Gửi dữ liệu đến server
    bool triggerFFT = sendDataToServer(data);
    
    // Nếu server yêu cầu FFT, gửi lệnh đến Node
    if (triggerFFT) {
        sendFFTCommand(data.device_id);
    }
}
```

### 3.2. Gửi HTTP POST đến Server

```cpp
bool sendDataToServer(SensorDataPacket &data) {
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("❌ WiFi not connected, cannot send to server");
        return false;
    }
    
    HTTPClient http;
    http.begin(serverUrl);
    http.addHeader("Content-Type", "application/json");
    http.setTimeout(5000);  // 5 second timeout
    
    // Tạo JSON payload
    StaticJsonDocument<512> doc;
    doc["device_id"] = data.device_id;
    doc["accel_x"] = data.accel_x;
    doc["accel_y"] = data.accel_y;
    doc["accel_z"] = data.accel_z;
    doc["battery_voltage_mv"] = data.battery_voltage_mv;
    doc["timestamp"] = data.timestamp;
    doc["gateway_id"] = GATEWAY_ID;
    
    String payload;
    serializeJson(doc, payload);
    
    Serial.println("📤 Sending to server: " + payload);
    
    int httpResponseCode = http.POST(payload);
    bool triggerFFT = false;
    
    if (httpResponseCode > 0) {
        String response = http.getString();
        Serial.printf("✅ HTTP Response code: %d\n", httpResponseCode);
        Serial.println("Response: " + response);
        
        // Parse response để kiểm tra trigger FFT
        StaticJsonDocument<256> responseDoc;
        DeserializationError error = deserializeJson(responseDoc, response);
        
        if (!error) {
            // Server trả về is_abnormal: true khi vượt ngưỡng
            if (responseDoc["is_abnormal"] == true) {
                Serial.println("⚠️ ABNORMAL VIBRATION DETECTED!");
                triggerFFT = true;
            }
        }
    } else {
        Serial.printf("❌ HTTP Error: %d\n", httpResponseCode);
        Serial.println("Error: " + http.errorToString(httpResponseCode));
    }
    
    http.end();
    return triggerFFT;
}
```

---

## 🔧 PHẦN 4: Gửi Lệnh FFT đến Node

### 4.1. Gửi Command qua ESP-NOW

```cpp
// Lưu MAC address của các node
typedef struct {
    char device_id[20];
    uint8_t mac[6];
    bool registered;
} NodeInfo;

NodeInfo nodeList[MAX_NODES];
int nodeCount = 0;

// Đăng ký node peer (gọi lần đầu khi nhận dữ liệu từ node mới)
bool registerNodePeer(const uint8_t *mac) {
    esp_now_peer_info_t peerInfo = {};
    memcpy(peerInfo.peer_addr, mac, 6);
    peerInfo.channel = 0;
    peerInfo.encrypt = false;
    
    if (esp_now_add_peer(&peerInfo) != ESP_OK) {
        Serial.println("❌ Failed to add peer");
        return false;
    }
    
    Serial.println("✅ Peer registered");
    return true;
}

// Tìm MAC address của node theo device_id
uint8_t* findNodeMAC(const char* device_id) {
    for (int i = 0; i < nodeCount; i++) {
        if (strcmp(nodeList[i].device_id, device_id) == 0) {
            return nodeList[i].mac;
        }
    }
    return nullptr;
}

// Gửi lệnh START FFT đến node
void sendFFTCommand(const char* device_id) {
    uint8_t* nodeMac = findNodeMAC(device_id);
    
    if (nodeMac == nullptr) {
        Serial.printf("❌ Node %s not found in registry\n", device_id);
        return;
    }
    
    CommandPacket cmd;
    cmd.command_type = CMD_START_FFT;
    cmd.sample_count = 512;   // 512 mẫu cho FFT
    cmd.sample_rate = 1000;   // 1000 Hz
    
    esp_err_t result = esp_now_send(nodeMac, 
                                    (uint8_t*)&cmd, 
                                    sizeof(cmd));
    
    if (result == ESP_OK) {
        Serial.printf("✅ FFT Command sent to %s\n", device_id);
    } else {
        Serial.printf("❌ Failed to send FFT command: %d\n", result);
    }
}
```

### 4.2. Auto-register Node Peer

Cập nhật callback `onDataReceive` để tự động đăng ký peer:

```cpp
void onDataReceive(const uint8_t *mac_addr, const uint8_t *data, int data_len) {
    char macStr[18];
    snprintf(macStr, sizeof(macStr), "%02X:%02X:%02X:%02X:%02X:%02X",
             mac_addr[0], mac_addr[1], mac_addr[2], 
             mac_addr[3], mac_addr[4], mac_addr[5]);
    
    Serial.printf("📡 Received from %s, size: %d\n", macStr, data_len);
    
    // Kiểm tra loại packet
    if (data_len == sizeof(SensorDataPacket)) {
        SensorDataPacket sensorData;
        memcpy(&sensorData, data, sizeof(sensorData));
        
        // Auto-register node nếu chưa có
        uint8_t* existingMac = findNodeMAC(sensorData.device_id);
        if (existingMac == nullptr && nodeCount < MAX_NODES) {
            // Thêm vào danh sách
            strcpy(nodeList[nodeCount].device_id, sensorData.device_id);
            memcpy(nodeList[nodeCount].mac, mac_addr, 6);
            nodeList[nodeCount].registered = false;
            
            // Đăng ký ESP-NOW peer
            if (registerNodePeer(mac_addr)) {
                nodeList[nodeCount].registered = true;
                nodeCount++;
                Serial.printf("✅ Auto-registered node: %s\n", sensorData.device_id);
            }
        }
        
        handleSensorData(sensorData);
    } 
    else if (data_len == sizeof(FFTDataPacket)) {
        FFTDataPacket fftData;
        memcpy(&fftData, data, sizeof(fftData));
        handleFFTData(fftData);
    }
}
```

---

## 🔧 PHẦN 5: Nhận và Xử Lý Dữ Liệu FFT

### 5.1. Handler cho FFT Data

```cpp
// Buffer để lưu các packet FFT (vì FFT có thể chia thành nhiều packet)
typedef struct {
    char device_id[20];
    uint8_t total_packets;
    uint8_t received_packets;
    float full_fft_data[512];  // Buffer đủ lớn cho toàn bộ FFT
    unsigned long start_time;
} FFTBuffer;

FFTBuffer fftBuffers[MAX_NODES];
int fftBufferCount = 0;

void handleFFTData(FFTDataPacket &data) {
    Serial.printf("📈 FFT Data from %s - Packet %d/%d\n", 
                  data.device_id, data.packet_number + 1, data.total_packets);
    
    // Tìm hoặc tạo buffer cho device này
    FFTBuffer* buffer = findOrCreateFFTBuffer(data.device_id, data.total_packets);
    
    if (buffer == nullptr) {
        Serial.println("❌ Cannot create FFT buffer");
        return;
    }
    
    // Copy dữ liệu vào buffer
    int offset = data.packet_number * 64;
    memcpy(&buffer->full_fft_data[offset], data.fft_data, sizeof(data.fft_data));
    buffer->received_packets++;
    
    // Kiểm tra xem đã nhận đủ chưa
    if (buffer->received_packets >= buffer->total_packets) {
        Serial.println("✅ All FFT packets received!");
        sendFFTDataToServer(*buffer);
        
        // Reset buffer
        buffer->received_packets = 0;
        buffer->device_id[0] = '\0';
    }
}

FFTBuffer* findOrCreateFFTBuffer(const char* device_id, uint8_t total_packets) {
    // Tìm buffer hiện có
    for (int i = 0; i < fftBufferCount; i++) {
        if (strcmp(fftBuffers[i].device_id, device_id) == 0) {
            return &fftBuffers[i];
        }
    }
    
    // Tạo buffer mới
    if (fftBufferCount < MAX_NODES) {
        FFTBuffer* newBuffer = &fftBuffers[fftBufferCount++];
        strcpy(newBuffer->device_id, device_id);
        newBuffer->total_packets = total_packets;
        newBuffer->received_packets = 0;
        newBuffer->start_time = millis();
        memset(newBuffer->full_fft_data, 0, sizeof(newBuffer->full_fft_data));
        return newBuffer;
    }
    
    return nullptr;
}
```

### 5.2. Gửi FFT Data đến Server

```cpp
void sendFFTDataToServer(FFTBuffer &buffer) {
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("❌ WiFi not connected");
        return;
    }
    
    HTTPClient http;
    // Endpoint riêng cho FFT data (cần thêm vào server)
    String url = String(serverUrl) + "/fft";  
    // Hoặc dùng endpoint khác: "http://YOUR_SERVER:3001/api/fft-data"
    
    http.begin(url);
    http.addHeader("Content-Type", "application/json");
    http.setTimeout(10000);  // 10 second timeout (FFT data lớn hơn)
    
    // Tạo JSON payload (có thể rất lớn)
    DynamicJsonDocument doc(16384);  // 16KB buffer
    doc["device_id"] = buffer.device_id;
    doc["gateway_id"] = GATEWAY_ID;
    doc["timestamp"] = millis();
    doc["sample_count"] = buffer.total_packets * 64;
    
    // Thêm FFT data array
    JsonArray fftArray = doc.createNestedArray("fft_data");
    for (int i = 0; i < buffer.total_packets * 64; i++) {
        fftArray.add(buffer.full_fft_data[i]);
    }
    
    String payload;
    serializeJson(doc, payload);
    
    Serial.printf("📤 Sending FFT data (%d bytes)\n", payload.length());
    
    int httpResponseCode = http.POST(payload);
    
    if (httpResponseCode > 0) {
        Serial.printf("✅ FFT sent successfully: %d\n", httpResponseCode);
    } else {
        Serial.printf("❌ FFT send failed: %d\n", httpResponseCode);
    }
    
    http.end();
}
```

---

## 🔧 PHẦN 6: Main Setup và Loop

### 6.1. Setup Function

```cpp
void setup() {
    Serial.begin(115200);
    delay(1000);
    
    Serial.println("\n=================================");
    Serial.println("   Gateway Vibration Monitor");
    Serial.println("=================================\n");
    
    // Initialize WiFi
    setupWiFi();
    
    // Initialize ESP-NOW
    setupESPNow();
    
    Serial.println("\n✅ Gateway Ready!\n");
}
```

### 6.2. Loop Function

```cpp
void loop() {
    // Gateway chủ yếu hoạt động qua callback
    // Loop có thể dùng để:
    
    // 1. Kiểm tra WiFi connection
    static unsigned long lastWiFiCheck = 0;
    if (millis() - lastWiFiCheck > 30000) {  // Check mỗi 30s
        if (WiFi.status() != WL_CONNECTED) {
            Serial.println("⚠️ WiFi disconnected, reconnecting...");
            WiFi.reconnect();
        }
        lastWiFiCheck = millis();
    }
    
    // 2. Timeout cho FFT buffers (nếu không nhận đủ packet trong 30s)
    static unsigned long lastBufferCheck = 0;
    if (millis() - lastBufferCheck > 5000) {  // Check mỗi 5s
        cleanupStaleFFTBuffers();
        lastBufferCheck = millis();
    }
    
    delay(10);
}

void cleanupStaleFFTBuffers() {
    unsigned long now = millis();
    for (int i = 0; i < fftBufferCount; i++) {
        if (fftBuffers[i].device_id[0] != '\0' &&
            (now - fftBuffers[i].start_time) > 30000) {  // 30s timeout
            
            Serial.printf("⚠️ Clearing stale FFT buffer for %s\n", 
                         fftBuffers[i].device_id);
            fftBuffers[i].device_id[0] = '\0';
            fftBuffers[i].received_packets = 0;
        }
    }
}
```

---

## 🔧 PHẦN 7: Code Phía Node (ESP32)

### 7.1. Cấu Trúc Node

Node cần có 2 chế độ hoạt động:
- **Normal Mode**: Gửi dữ liệu cảm biến định kỳ
- **FFT Mode**: Thu thập và gửi dữ liệu FFT khi nhận lệnh

```cpp
#include <esp_now.h>
#include <WiFi.h>
#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <arduinoFFT.h>

// Node Configuration
#define DEVICE_ID "NODE_001"
uint8_t gatewayMac[] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF}; // Broadcast hoặc MAC của Gateway

// FFT Configuration
#define FFT_SAMPLES 512
#define SAMPLING_FREQUENCY 1000  // 1000 Hz

ArduinoFFT<double> FFT;
Adafruit_MPU6050 mpu;

bool fftMode = false;
```

### 7.2. Callback Nhận Lệnh từ Gateway

```cpp
void onCommandReceive(const uint8_t *mac_addr, const uint8_t *data, int data_len) {
    if (data_len == sizeof(CommandPacket)) {
        CommandPacket cmd;
        memcpy(&cmd, data, sizeof(cmd));
        
        if (cmd.command_type == CMD_START_FFT) {
            Serial.println("🎯 START FFT Command received!");
            fftMode = true;
            performFFTAnalysis(cmd.sample_count, cmd.sample_rate);
        }
        else if (cmd.command_type == CMD_STOP_FFT) {
            Serial.println("🛑 STOP FFT Command received!");
            fftMode = false;
        }
    }
}
```

### 7.3. Thu Thập và Gửi Dữ Liệu FFT

```cpp
void performFFTAnalysis(uint16_t sampleCount, uint16_t sampleRate) {
    Serial.println("📊 Starting FFT analysis...");
    
    double vReal[FFT_SAMPLES];
    double vImag[FFT_SAMPLES];
    
    // Thu thập dữ liệu
    unsigned long samplingPeriod = (1000000 / sampleRate);
    for (int i = 0; i < FFT_SAMPLES; i++) {
        unsigned long startTime = micros();
        
        sensors_event_t a, g, temp;
        mpu.getEvent(&a, &g, &temp);
        
        // Sử dụng magnitude của gia tốc
        vReal[i] = sqrt(a.acceleration.x * a.acceleration.x +
                       a.acceleration.y * a.acceleration.y +
                       a.acceleration.z * a.acceleration.z);
        vImag[i] = 0;
        
        while (micros() - startTime < samplingPeriod) {
            // Chờ đến chu kỳ tiếp theo
        }
    }
    
    // Thực hiện FFT
    FFT = ArduinoFFT<double>(vReal, vImag, FFT_SAMPLES, sampleRate);
    FFT.windowing(FFTWindow::Hamming, FFTDirection::Forward);
    FFT.compute(FFTDirection::Forward);
    FFT.complexToMagnitude();
    
    // Gửi kết quả qua ESP-NOW
    sendFFTResults(vReal);
    
    fftMode = false;
    Serial.println("✅ FFT analysis complete");
}

void sendFFTResults(double* fftData) {
    // Chia nhỏ thành các packet (mỗi packet 64 giá trị)
    uint8_t totalPackets = (FFT_SAMPLES / 2) / 64;  // Chỉ gửi nửa đầu (frequency domain)
    
    for (uint8_t i = 0; i < totalPackets; i++) {
        FFTDataPacket packet;
        strcpy(packet.device_id, DEVICE_ID);
        packet.packet_number = i;
        packet.total_packets = totalPackets;
        packet.timestamp = millis();
        
        // Copy 64 giá trị
        for (int j = 0; j < 64; j++) {
            packet.fft_data[j] = (float)fftData[i * 64 + j];
        }
        
        esp_now_send(gatewayMac, (uint8_t*)&packet, sizeof(packet));
        delay(10);  // Delay nhỏ giữa các packet
    }
}
```

---

## 📊 PHẦN 8: Cập Nhật Server (Optional)

Để xử lý dữ liệu FFT, bạn cần thêm endpoint vào `server.js`:

```javascript
// Add to server.js

// Receive FFT data from Gateway
app.post('/api/fft-data', (req, res) => {
    console.log('📈 Received FFT data');
    const { device_id, fft_data, sample_count, gateway_id } = req.body;
    
    if (!device_id || !fft_data) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Lưu FFT data vào database hoặc file
    // Phân tích FFT để tìm tần số bất thường
    
    const dominantFrequency = findDominantFrequency(fft_data, sample_count);
    
    console.log(`Device ${device_id} - Dominant Frequency: ${dominantFrequency} Hz`);
    
    // Emit real-time FFT data to clients
    io.emit('fft_data', {
        device_id,
        fft_data,
        dominant_frequency: dominantFrequency,
        timestamp: new Date().toISOString()
    });
    
    res.json({ success: true, dominant_frequency: dominantFrequency });
});

function findDominantFrequency(fftData, sampleCount) {
    let maxMagnitude = 0;
    let maxIndex = 0;
    
    for (let i = 1; i < fftData.length && i < sampleCount / 2; i++) {
        if (fftData[i] > maxMagnitude) {
            maxMagnitude = fftData[i];
            maxIndex = i;
        }
    }
    
    // Calculate frequency from index
    const samplingRate = 1000;  // Hz
    const frequency = (maxIndex * samplingRate) / sampleCount;
    
    return frequency.toFixed(2);
}
```

---

## ✅ PHẦN 9: Checklist Triển Khai

### Gateway:
- [ ] Kết nối WiFi thành công
- [ ] ESP-NOW initialized
- [ ] Nhận được dữ liệu từ Node
- [ ] Gửi HTTP POST đến Server thành công
- [ ] Nhận response từ Server
- [ ] Phát hiện `is_abnormal: true` từ Server
- [ ] Gửi FFT command đến Node thành công
- [ ] Nhận FFT data từ Node
- [ ] Reassemble FFT packets
- [ ] Gửi FFT data đến Server

### Node:
- [ ] ESP-NOW initialized
- [ ] Gửi sensor data định kỳ đến Gateway
- [ ] Nhận command từ Gateway
- [ ] Thực hiện FFT analysis
- [ ] Gửi FFT data qua ESP-NOW (nhiều packets)

### Server:
- [ ] Nhận sensor data từ Gateway
- [ ] Phân tích và phát hiện vượt ngưỡng
- [ ] Trả về `is_abnormal: true` khi cần FFT
- [ ] Nhận và xử lý FFT data

---

## 🐛 Debugging Tips

### 1. Kiểm tra kết nối WiFi
```cpp
if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi Status: Disconnected");
} else {
    Serial.println("WiFi Connected - IP: " + WiFi.localIP().toString());
}
```

### 2. Kiểm tra ESP-NOW
```cpp
// Trong onDataReceive callback
Serial.printf("ESP-NOW received %d bytes from %s\n", data_len, macStr);
```

### 3. Kiểm tra HTTP Response
```cpp
Serial.println("HTTP Response Code: " + String(httpResponseCode));
Serial.println("Response Body: " + http.getString());
```

### 4. Monitor Serial Output
- Gateway: Xem logs của việc nhận ESP-NOW và gửi HTTP
- Node: Xem logs của việc gửi data và nhận command
- Server: Xem logs trong terminal chạy Node.js

---

## 📝 Notes Quan Trọng

1. **ESP-NOW Channel**: Đảm bảo Gateway và Node dùng cùng WiFi channel
2. **Packet Size**: ESP-NOW giới hạn 250 bytes/packet, nên FFT data cần chia nhỏ
3. **WiFi Mode**: Gateway phải dùng `WIFI_AP_STA` để vừa ESP-NOW vừa kết nối WiFi
4. **Timeout**: Đặt timeout hợp lý cho HTTP requests (5-10s)
5. **Memory**: FFT buffer chiếm nhiều RAM, cân nhắc dùng PSRAM nếu có
6. **Battery**: FFT analysis tốn pin, chỉ trigger khi cần thiết

---

## 🚀 Tối Ưu

1. **Batch Processing**: Gộp nhiều sensor data packets trước khi gửi HTTP
2. **Compression**: Nén FFT data trước khi gửi
3. **Caching**: Cache kết quả phân tích để tránh trigger FFT quá thường xuyên
4. **Queue**: Dùng queue để xử lý dữ liệu không đồng bộ

Chúc bạn triển khai thành công! 🎉
