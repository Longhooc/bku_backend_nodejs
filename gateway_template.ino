/*
 * Gateway ESP32 - Vibration Monitoring System với FFT Trigger
 * 
 * Chức năng:
 * 1. Nhận dữ liệu từ Node qua ESP-NOW
 * 2. Forward dữ liệu đến Server qua HTTP POST
 * 3. Nhận response từ Server
 * 4. Nếu trigger_fft = true, gửi lệnh FFT đến Node
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <esp_now.h>
#include <ArduinoJson.h>

// ==================== CẤU HÌNH ====================
const char* WIFI_SSID = "YOUR_WIFI_SSID";           // ← Sửa thành WiFi của bạn
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";   // ← Sửa password
const char* SERVER_URL = "http://192.168.1.100:3001/api/sensor-data";  // ← Sửa IP server
const char* GATEWAY_ID = "GATEWAY_001";

#define MAX_NODES 10

// ==================== CẤU TRÚC DỮ LIỆU ====================
// Data từ Node
typedef struct {
    char device_id[20];
    float accel_x;
    float accel_y;
    float accel_z;
    uint32_t timestamp;
    uint16_t battery_voltage_mv;
} SensorDataPacket;

// FFT Data từ Node
typedef struct {
    char device_id[20];
    uint8_t packet_number;
    uint8_t total_packets;
    float fft_data[64];
    uint32_t timestamp;
} FFTDataPacket;

// Command gửi đến Node
typedef struct {
    uint8_t command_type;
    uint16_t sample_count;
    uint16_t sample_rate;
} CommandPacket;

// Node registry
typedef struct {
    char device_id[20];
    uint8_t mac[6];
    bool registered;
} NodeInfo;

NodeInfo nodeList[MAX_NODES];
int nodeCount = 0;

// Command types
#define CMD_START_FFT 0x01
#define CMD_STOP_FFT  0x02

// ==================== SETUP ====================
void setup() {
    Serial.begin(115200);
    delay(1000);
    
    Serial.println("\n╔══════════════════════════════════════╗");
    Serial.println("║  Gateway Vibration Monitoring FFT   ║");
    Serial.println("╚══════════════════════════════════════╝\n");
    
    // Setup WiFi
    setupWiFi();
    
    // Setup ESP-NOW
    setupESPNow();
    
    Serial.println("\n✅ Gateway sẵn sàng!\n");
}

// ==================== WIFI SETUP ====================
void setupWiFi() {
    Serial.println("📶 Connecting to WiFi...");
    
    WiFi.mode(WIFI_AP_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 20) {
        delay(500);
        Serial.print(".");
        attempts++;
    }
    
    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\n✅ WiFi Connected!");
        Serial.print("IP: ");
        Serial.println(WiFi.localIP());
    } else {
        Serial.println("\n❌ WiFi Failed!");
    }
}

// ==================== ESP-NOW SETUP ====================
void setupESPNow() {
    if (esp_now_init() != ESP_OK) {
        Serial.println("❌ ESP-NOW Init Failed!");
        return;
    }
    
    Serial.println("✅ ESP-NOW Initialized");
    
    esp_now_register_recv_cb(onDataReceive);
    esp_now_register_send_cb(onDataSent);
}

// ==================== CALLBACK: NHẬN DATA TỪ NODE ====================
void onDataReceive(const uint8_t *mac_addr, const uint8_t *data, int data_len) {
    char macStr[18];
    snprintf(macStr, sizeof(macStr), "%02X:%02X:%02X:%02X:%02X:%02X",
             mac_addr[0], mac_addr[1], mac_addr[2], 
             mac_addr[3], mac_addr[4], mac_addr[5]);
    
    Serial.printf("\n📡 Received from %s (%d bytes)\n", macStr, data_len);
    
    // Sensor Data
    if (data_len == sizeof(SensorDataPacket)) {
        SensorDataPacket sensorData;
        memcpy(&sensorData, data, sizeof(sensorData));
        
        // Auto-register node
        autoRegisterNode(sensorData.device_id, mac_addr);
        
        // Xử lý sensor data
        handleSensorData(sensorData);
    }
    // FFT Data
    else if (data_len == sizeof(FFTDataPacket)) {
        FFTDataPacket fftData;
        memcpy(&fftData, data, sizeof(fftData));
        handleFFTData(fftData);
    }
}

void onDataSent(const uint8_t *mac_addr, esp_now_send_status_t status) {
    Serial.print("📤 Send Status: ");
    Serial.println(status == ESP_NOW_SEND_SUCCESS ? "✅ Success" : "❌ Fail");
}

// ==================== AUTO REGISTER NODE ====================
void autoRegisterNode(const char* device_id, const uint8_t* mac) {
    // Kiểm tra xem node đã được register chưa
    for (int i = 0; i < nodeCount; i++) {
        if (strcmp(nodeList[i].device_id, device_id) == 0) {
            return; // Đã có rồi
        }
    }
    
    if (nodeCount >= MAX_NODES) {
        Serial.println("⚠️ Max nodes reached!");
        return;
    }
    
    // Thêm node mới
    strcpy(nodeList[nodeCount].device_id, device_id);
    memcpy(nodeList[nodeCount].mac, mac, 6);
    
    // Register ESP-NOW peer
    esp_now_peer_info_t peerInfo = {};
    memcpy(peerInfo.peer_addr, mac, 6);
    peerInfo.channel = 0;
    peerInfo.encrypt = false;
    
    if (esp_now_add_peer(&peerInfo) == ESP_OK) {
        nodeList[nodeCount].registered = true;
        nodeCount++;
        Serial.printf("✅ Registered new node: %s\n", device_id);
    } else {
        Serial.printf("❌ Failed to register node: %s\n", device_id);
    }
}

// ==================== XỬ LÝ SENSOR DATA ====================
void handleSensorData(SensorDataPacket &data) {
    Serial.println("\n📊 Processing Sensor Data:");
    Serial.printf("  Device: %s\n", data.device_id);
    Serial.printf("  Accel: X=%.2f Y=%.2f Z=%.2f\n", 
                  data.accel_x, data.accel_y, data.accel_z);
    Serial.printf("  Battery: %d mV\n", data.battery_voltage_mv);
    
    // ★ QUAN TRỌNG: Gửi đến server và nhận response
    bool triggerFFT = sendDataToServer(data);
    
    // ★ Nếu server yêu cầu FFT
    if (triggerFFT) {
        Serial.println("\n⚠️ ═══════════════════════════════");
        Serial.println("⚠️  TRIGGER FFT COLLECTION!");
        Serial.println("⚠️ ═══════════════════════════════\n");
        sendFFTCommand(data.device_id);
    }
}

// ==================== GỬI DATA ĐẾN SERVER ====================
bool sendDataToServer(SensorDataPacket &data) {
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("❌ WiFi not connected!");
        return false;
    }
    
    HTTPClient http;
    http.begin(SERVER_URL);
    http.addHeader("Content-Type", "application/json");
    http.setTimeout(5000);
    
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
    
    Serial.println("📤 Sending to server...");
    
    int httpCode = http.POST(payload);
    bool triggerFFT = false;
    
    if (httpCode == 200) {
        String response = http.getString();
        Serial.printf("✅ Server Response (HTTP %d):\n", httpCode);
        Serial.println(response);
        
        // ★ PARSE RESPONSE ĐỂ KIỂM TRA TRIGGER FFT
        StaticJsonDocument<256> responseDoc;
        DeserializationError error = deserializeJson(responseDoc, response);
        
        if (!error) {
            bool isAbnormal = responseDoc["is_abnormal"];
            const char* severity = responseDoc["severity"];
            bool shouldTriggerFFT = responseDoc["trigger_fft"];
            
            Serial.printf("  is_abnormal: %s\n", isAbnormal ? "true" : "false");
            Serial.printf("  severity: %s\n", severity);
            Serial.printf("  trigger_fft: %s\n", shouldTriggerFFT ? "true" : "false");
            
            if (shouldTriggerFFT) {
                triggerFFT = true;
            }
        } else {
            Serial.println("⚠️ Failed to parse response JSON");
        }
    } else {
        Serial.printf("❌ HTTP Error: %d\n", httpCode);
        Serial.println(http.errorToString(httpCode));
    }
    
    http.end();
    return triggerFFT;
}

// ==================== TÌM MAC CỦA NODE ====================
uint8_t* findNodeMAC(const char* device_id) {
    for (int i = 0; i < nodeCount; i++) {
        if (strcmp(nodeList[i].device_id, device_id) == 0) {
            return nodeList[i].mac;
        }
    }
    return nullptr;
}

// ==================== GỬI LỆNH FFT ĐẾN NODE ====================
void sendFFTCommand(const char* device_id) {
    uint8_t* nodeMac = findNodeMAC(device_id);
    
    if (nodeMac == nullptr) {
        Serial.printf("❌ Node %s not found!\n", device_id);
        return;
    }
    
    CommandPacket cmd;
    cmd.command_type = CMD_START_FFT;
    cmd.sample_count = 512;   // 512 mẫu FFT
    cmd.sample_rate = 1000;   // 1000 Hz
    
    Serial.printf("📤 Sending FFT command to %s...\n", device_id);
    
    esp_err_t result = esp_now_send(nodeMac, (uint8_t*)&cmd, sizeof(cmd));
    
    if (result == ESP_OK) {
        Serial.println("✅ FFT command sent!");
    } else {
        Serial.printf("❌ Failed to send FFT command: %d\n", result);
    }
}

// ==================== XỬ LÝ FFT DATA TỪ NODE ====================
void handleFFTData(FFTDataPacket &data) {
    Serial.printf("\n📈 FFT Data: %s [%d/%d]\n", 
                  data.device_id, 
                  data.packet_number + 1, 
                  data.total_packets);
    
    // TODO: Reassemble FFT packets và gửi đến server
    // Xem GATEWAY_IMPLEMENTATION_GUIDE.md cho code đầy đủ
}

// ==================== MAIN LOOP ====================
void loop() {
    // Kiểm tra WiFi connection
    static unsigned long lastWiFiCheck = 0;
    if (millis() - lastWiFiCheck > 30000) {
        if (WiFi.status() != WL_CONNECTED) {
            Serial.println("⚠️ WiFi disconnected, reconnecting...");
            WiFi.reconnect();
        }
        lastWiFiCheck = millis();
    }
    
    delay(10);
}
