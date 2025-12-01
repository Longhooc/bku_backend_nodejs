# Sơ Đồ Kiến Trúc Hệ Thống Giám Sát Rung Động

## 1. Tổng Quan Kiến Trúc

```mermaid
graph TB
    ESP32["ESP32 Sensor<br/>(BMI160)"] -->|HTTP POST| Backend["Backend Server<br/>(Node.js + Express)"]
    Backend -->|Store Data| DB["SQLite Database<br/>(vibration_data.db)"]
    Backend -->|Real-time Emit| WS["Socket.IO"]
    WS -->|sensor_data event| Frontend["Frontend<br/>(HTML + Chart.js)"]
    Frontend -->|HTTP GET| Backend
    DB -->|Query Results| Backend
    
    style ESP32 fill:#e1f5ff
    style Backend fill:#fff4e1
    style DB fill:#e8f5e9
    style WS fill:#f3e5f5
    style Frontend fill:#fce4ec
```

## 2. Cấu Trúc Database Schema

```mermaid
erDiagram
    SENSOR_DATA {
        int id PK
        text device_id FK
        datetime timestamp
        real accel_x
        real accel_y
        real accel_z
        real vibration_magnitude
        int is_abnormal
    }
    
    DEVICES {
        text device_id PK
        text device_name
        text location
        datetime created_at
        int is_active
    }
    
    VIBRATION_ALERTS {
        int id PK
        text device_id FK
        text alert_type
        text severity
        text message
        datetime timestamp
        int is_resolved
    }
    
    DEVICES ||--o{ SENSOR_DATA : "has"
    DEVICES ||--o{ VIBRATION_ALERTS : "generates"
```

## 3. Flow Nhận Dữ Liệu Từ ESP32

```mermaid
sequenceDiagram
    participant ESP32
    participant HTTP as HTTP Server<br/>(Port 3001)
    participant HTTPS as HTTPS Server<br/>(Port 3000)
    participant Handler as handleSensorDataPost()
    participant DB as SQLite DB
    participant Analyzer as VibrationAnalyzer
    participant Cache as Battery Cache<br/>(In-Memory)
    participant SocketIO as Socket.IO
    participant Frontend as Web Clients

    ESP32->>HTTP: POST /api/sensor-data<br/>{device_id, accel_x, accel_y, accel_z, battery_voltage_mv}
    HTTP->>Handler: Request Body
    
    Handler->>Handler: Validate Fields
    Handler->>DB: Check Device Exists
    
    alt Device Not Found
        Handler->>DB: Auto-register Device<br/>INSERT INTO devices
    end
    
    Handler->>Analyzer: calculateVibrationMagnitude(x, y, z)
    Analyzer-->>Handler: magnitude = √(x² + y² + z²)
    
    Handler->>Analyzer: detectAbnormalVibration(deviceId, magnitude)
    Analyzer->>Analyzer: Update Baseline (Moving Average)
    Analyzer->>Analyzer: Check Threshold (1.5x baseline)
    Analyzer->>Analyzer: Detect Spike (2.0x baseline)
    Analyzer->>Analyzer: Check High Frequency Pattern
    Analyzer-->>Handler: {isAbnormal, severity, baseline, threshold}
    
    Handler->>DB: INSERT INTO sensor_data<br/>(timestamp in UTC+7)
    
    alt Abnormal Vibration Detected
        Handler->>DB: INSERT INTO vibration_alerts<br/>(severity: CRITICAL/HIGH/MEDIUM/LOW)
    end
    
    alt Battery Voltage Provided
        Handler->>Cache: Store in lastBatteryByDevice Map<br/>{voltage, updatedAt}
    end
    
    Handler->>SocketIO: emit('sensor_data', emitData)
    SocketIO->>Frontend: Broadcast to All Connected Clients
    
    Handler-->>HTTP: Response 200<br/>{success, vibration_magnitude, is_abnormal, severity}
    HTTP-->>ESP32: JSON Response
```

## 4. Flow Tải Dữ Liệu Frontend

```mermaid
sequenceDiagram
    participant User
    participant Browser as Frontend (Browser)
    participant SocketIO as Socket.IO Client
    participant API as Backend API
    participant DB as SQLite DB
    
    User->>Browser: Load Page
    Browser->>Browser: DOMContentLoaded Event
    
    Browser->>SocketIO: Initialize Connection io()
    SocketIO-->>Browser: connect event
    
    Browser->>API: GET /api/devices?include_simulated=0
    API->>DB: SELECT devices with data_count
    DB-->>API: Device List
    API->>API: Enrich with Battery from Cache
    API-->>Browser: JSON Array of Devices
    
    loop For Each Device
        Browser->>Browser: createDeviceChartCard(device)
        Browser->>Browser: Initialize Chart.js Chart
        Browser->>API: GET /api/sensor-data/:device_id?hours=24&limit=100000
        API->>DB: Find MAX(timestamp) for device
        API->>DB: SELECT data WHERE timestamp > (max - hours)
        DB-->>API: Historical Data Points
        API-->>Browser: {device_id, data: [...]}
        Browser->>Browser: Store in deviceDataStore Map
        Browser->>Browser: renderChartFromStore()
        Browser->>Browser: Detect Gaps > 12 minutes
        Browser->>Browser: Update Disconnection Plugin
        Browser->>Browser: Update Chart Display
    end
    
    Browser->>API: GET /api/alerts?hours=24
    API->>DB: SELECT alerts WHERE timestamp > (now - hours)
    DB-->>API: Alert Records
    API-->>Browser: JSON Array of Alerts
    Browser->>Browser: displayAlerts()
```

## 5. Flow Cập Nhật Real-time

```mermaid
sequenceDiagram
    participant ESP32
    participant Backend as Backend Server
    participant SocketIO as Socket.IO
    participant Browser as Frontend
    participant Chart as Chart.js
    participant Store as deviceDataStore<br/>(In-Memory)
    
    ESP32->>Backend: POST /api/sensor-data
    Backend->>Backend: Process & Store in DB
    Backend->>SocketIO: emit('sensor_data', data)
    SocketIO->>Browser: sensor_data event<br/>{device_id, timestamp, accel_x/y/z,<br/>vibration_magnitude, battery_voltage_mv}
    
    Browser->>Browser: Find chartInfo for device_id
    
    alt Chart Found
        Browser->>Browser: appendRealtimePoint(chartInfo, data)
        Browser->>Store: Get deviceDataStore[deviceId]
        Browser->>Store: Push new point {t, magnitude, baseline}
        Browser->>Browser: Trim old points outside time window
        Browser->>Browser: renderChartFromStore()
        Browser->>Browser: Calculate new gaps (> 12 min)
        Browser->>Chart: Update chart.data.datasets
        Browser->>Chart: Update disconnectionPlugin.gaps
        Browser->>Chart: chart.update()
        
        alt Battery Voltage Present
            Browser->>Browser: updateBatteryVoltage(device_id, voltage_mv)
            Browser->>Browser: Update UI Display with Color Coding
        end
        
        Browser->>Browser: Check Last Data Time
        alt Data Recent (< 12 min)
            Browser->>Browser: Update Status: "Đang hoạt động" (Green)
        else Data Old (> 12 min)
            Browser->>Browser: Update Status: "Mất kết nối" (Red)
        end
    end
```

## 6. Backend VibrationAnalyzer Logic

```mermaid
flowchart TD
    Start([Receive Sensor Data]) --> Input["Input: deviceId, magnitude, accelData"]
    Input --> CheckBaseline{Device Baseline<br/>Exists?}
    
    CheckBaseline -->|No| InitBaseline["Initialize Baseline<br/>baseline = magnitude<br/>samples = []<br/>lastUpdate = now"]
    CheckBaseline -->|Yes| GetBaseline["Get Existing Baseline<br/>& Recent Data"]
    
    InitBaseline --> AddToRecent
    GetBaseline --> AddToRecent["Add to recentData[]<br/>(Keep last 50 samples)"]
    
    AddToRecent --> CheckSamples{recentData.length<br/>>= 10?}
    CheckSamples -->|Yes| UpdateBaseline["Update Baseline<br/>baseline = avg(recentData)<br/>(Moving Average)"]
    CheckSamples -->|No| SkipUpdate["Keep Current Baseline"]
    
    UpdateBaseline --> CalcThreshold
    SkipUpdate --> CalcThreshold["Calculate Threshold<br/>threshold = baseline × 1.5"]
    
    CalcThreshold --> CheckAbnormal{magnitude ><br/>threshold?}
    CheckAbnormal -->|Yes| SetAbnormal["isAbnormal = true"]
    CheckAbnormal -->|No| CheckSpike{magnitude ><br/>baseline × 2.0<br/>AND samples >= 3?}
    
    CheckSpike -->|Yes| SetAbnormal
    CheckSpike -->|No| CheckFreq["detectHighFrequencyPattern()<br/>variance > mean × 0.3?"]
    
    CheckFreq -->|Yes| SetAbnormal
    CheckFreq -->|No| SetNormal["isAbnormal = false"]
    
    SetAbnormal --> CalcSeverity
    SetNormal --> CalcSeverity["Calculate Severity<br/>ratio = magnitude / baseline"]
    
    CalcSeverity --> Severity{Severity Level}
    Severity -->|ratio > 3.0| Critical["CRITICAL"]
    Severity -->|ratio > 2.0| High["HIGH"]
    Severity -->|ratio > 1.5| Medium["MEDIUM"]
    Severity -->|else| Low["LOW"]
    
    Critical --> Return
    High --> Return
    Medium --> Return
    Low --> Return["Return Analysis Result<br/>{isAbnormal, severity,<br/>baseline, threshold}"]
    
    Return --> End([End])
    
    style Start fill:#e1f5ff
    style End fill:#e1f5ff
    style SetAbnormal fill:#ffebee
    style Critical fill:#f44336,color:#fff
    style High fill:#ff9800,color:#fff
    style Medium fill:#ffc107
    style Low fill:#4caf50,color:#fff
```

## 7. Frontend Auto-Refresh Mechanism

```mermaid
flowchart TD
    Start([Page Load]) --> InitRefresh["Initialize Auto-Refresh<br/>autoRefreshEnabled = true<br/>interval = 30s"]
    
    InitRefresh --> StartInterval["setInterval(30000)"]
    
    StartInterval --> IntervalTick["⏰ Every 30 Seconds"]
    
    IntervalTick --> CheckEnabled{autoRefreshEnabled<br/>= true?}
    CheckEnabled -->|No| Skip["Skip Refresh"]
    CheckEnabled -->|Yes| CheckSocket{Socket<br/>Connected?}
    
    CheckSocket -->|Yes| SkipPoll["Skip Polling<br/>(Using Real-time Data)"]
    CheckSocket -->|No| Refresh["refreshIncrementalAll()"]
    
    SkipPoll --> LoadAlerts
    Refresh --> LoadAlerts["loadAlerts()"]
    
    LoadAlerts --> IntervalTick
    Skip --> IntervalTick
    
    UserToggle["👤 User Clicks Toggle Button"] --> ToggleState{Current State?}
    ToggleState -->|Enabled| Disable["autoRefreshEnabled = false<br/>stopAutoRefresh()<br/>Button: 'Tự động: TẮT' (Red)"]
    ToggleState -->|Disabled| Enable["autoRefreshEnabled = true<br/>startAutoRefresh()<br/>Button: 'Tự động: BẬT' (Green)"]
    
    Disable --> IntervalTick
    Enable --> IntervalTick
    
    style Start fill:#e1f5ff
    style UserToggle fill:#fff3e0
    style CheckSocket fill:#e8f5e9
```

## 8. Incremental Data Refresh Logic

```mermaid
flowchart TD
    Start([refreshIncrementalAll]) --> ForEach["For Each Device in deviceCharts"]
    
    ForEach --> GetStore["Get deviceDataStore[deviceId]"]
    GetStore --> CheckLast{Has Last<br/>Timestamp?}
    
    CheckLast -->|Yes| BuildURL1["Build URL with 'since' parameter<br/>/api/sensor-data/:id?since=LAST_TIME&limit=20000"]
    CheckLast -->|No| BuildURL2["Build URL with 'hours' parameter<br/>/api/sensor-data/:id?hours=6&limit=6000"]
    
    BuildURL1 --> Fetch
    BuildURL2 --> Fetch["Fetch from API"]
    
    Fetch --> CheckResponse{Response OK?}
    CheckResponse -->|No| Next["Continue to Next Device"]
    CheckResponse -->|Yes| GetData["Get result.data[]"]
    
    GetData --> CheckEmpty{Data Empty?}
    CheckEmpty -->|Yes| Next
    CheckEmpty -->|No| AppendLoop["For Each Incoming Point"]
    
    AppendLoop --> CheckNewer{Timestamp ><br/>Last in Store?}
    CheckNewer -->|Yes| Push["Push to deviceDataStore<br/>{t, magnitude, baseline}"]
    CheckNewer -->|No| SkipDup["Skip Duplicate"]
    
    Push --> TrimOld
    SkipDup --> TrimOld["Trim Old Points<br/>Outside Time Window"]
    
    TrimOld --> Render["renderChartFromStore()<br/>Update Chart Display"]
    Render --> Next
    
    Next --> CheckMore{More Devices?}
    CheckMore -->|Yes| ForEach
    CheckMore -->|No| End([End])
    
    style Start fill:#e1f5ff
    style End fill:#e1f5ff
    style CheckNewer fill:#fff3e0
```

## 9. Disconnection Detection Flow

```mermaid
flowchart TD
    Start([renderChartFromStore]) --> GetSeries["Get windowed[] data points<br/>within current time range"]
    
    GetSeries --> InitGaps["gaps = []<br/>GAP_THRESHOLD = 12 minutes"]
    
    InitGaps --> LoopPoints["Loop i = 1 to windowed.length"]
    
    LoopPoints --> CalcDiff["diff = windowed[i].t - windowed[i-1].t"]
    CalcDiff --> CheckGap{diff ><br/>GAP_THRESHOLD?}
    
    CheckGap -->|Yes| AddGap["gaps.push({<br/>  start: windowed[i-1].t,<br/>  end: windowed[i].t<br/>})"]
    CheckGap -->|No| Continue["Continue Loop"]
    
    AddGap --> Continue
    Continue --> MorePoints{More Points?}
    MorePoints -->|Yes| LoopPoints
    MorePoints -->|No| CheckEnd["Get lastPoint and now"]
    
    CheckEnd --> CheckRecent{now - lastPoint.t<br/>> GAP_THRESHOLD?}
    
    CheckRecent -->|Yes| AddEndGap["gaps.push({<br/>  start: lastPoint.t,<br/>  end: now<br/>})<br/><br/>Update Status: 'Mất kết nối' (Red)"]
    CheckRecent -->|No| SetActive["Update Status: 'Đang hoạt động' (Green)"]
    
    AddEndGap --> UpdatePlugin
    SetActive --> UpdatePlugin["chart.options.plugins<br/>.disconnectionPlugin.gaps = gaps"]
    
    UpdatePlugin --> DrawRed["Plugin draws RED rectangles<br/>for each gap in chart area"]
    
    DrawRed --> End([chart.update])
    
    style Start fill:#e1f5ff
    style End fill:#e1f5ff
    style AddEndGap fill:#ffebee
    style SetActive fill:#e8f5e9
    style DrawRed fill:#ffcdd2
```

## 10. API Endpoints Summary

```mermaid
graph LR
    subgraph "Backend API Endpoints"
        A["POST /api/sensor-data<br/>(HTTP:3001 & HTTPS:3000)"] --> A1["Receive from ESP32<br/>Auto-register device<br/>Analyze vibration<br/>Store to DB<br/>Emit Socket.IO"]
        
        B["GET /api/sensor-data/:device_id"] --> B1["Query Parameters:<br/>- hours (default: 24)<br/>- limit (default: 100000)<br/>- since (optional timestamp)<br/><br/>Returns historical data<br/>with time-based filtering"]
        
        C["GET /api/devices"] --> C1["Query Parameters:<br/>- include_simulated (0/1)<br/><br/>Returns device list<br/>+ data_count<br/>+ last_data_time<br/>+ battery voltage (from cache)"]
        
        D["POST /api/devices"] --> D1["Register new device<br/>Body: {device_id, device_name, location}"]
        
        E["GET /api/alerts"] --> E1["Query Parameters:<br/>- device_id (optional)<br/>- hours (default: 24)<br/><br/>Returns vibration alerts<br/>with device info"]
        
        F["GET /"] --> F1["Serve index.html"]
    end
    
    style A fill:#ffebee
    style B fill:#e3f2fd
    style C fill:#e3f2fd
    style D fill:#fff3e0
    style E fill:#e3f2fd
    style F fill:#f3e5f5
```

## 11. Frontend Component Architecture

```mermaid
graph TB
    subgraph "Frontend Architecture"
        Main["Main Application"] --> Socket["Socket.IO Client<br/>(Real-time Updates)"]
        Main --> ChartMgr["Chart Manager"]
        Main --> DataMgr["Data Manager"]
        Main --> UI["UI Controller"]
        
        Socket --> EventHandlers["Event Handlers<br/>- connect<br/>- sensor_data<br/>- disconnect"]
        EventHandlers --> ChartMgr
        
        ChartMgr --> DeviceCharts["deviceCharts Map<br/>(device_id → {chart, device})"]
        ChartMgr --> ChartJS["Chart.js Instances"]
        ChartMgr --> Plugin["Disconnection Plugin<br/>(Draw Red Zones)"]
        
        DataMgr --> Store["deviceDataStore Map<br/>(device_id → [{t, magnitude, baseline}])"]
        DataMgr --> Cache["Device Metadata<br/>- lastTimestamp<br/>- battery voltage"]
        
        UI --> RangeSelector["Time Range Selector<br/>(3h, 1d, 3d, 1w, 1m, 1y)"]
        UI --> AutoRefresh["Auto-Refresh Toggle<br/>(30s interval)"]
        UI --> Alerts["Alerts Display"]
        UI --> Battery["Battery Status Display"]
        UI --> Status["Connection Status<br/>(Active/Disconnected)"]
        
        API["API Service"] --> Fetch1["GET /api/devices"]
        API --> Fetch2["GET /api/sensor-data/:id"]
        API --> Fetch3["GET /api/alerts"]
        
        DataMgr --> API
        ChartMgr --> API
    end
    
    style Socket fill:#f3e5f5
    style ChartMgr fill:#e3f2fd
    style DataMgr fill:#e8f5e9
    style UI fill:#fff3e0
```

## 12. Data Flow Complete Overview

```mermaid
sequenceDiagram
    participant ESP32 as ESP32 Sensor
    participant BE as Backend<br/>(Node.js)
    participant DB as SQLite<br/>Database
    participant Analyzer as Vibration<br/>Analyzer
    participant WS as Socket.IO
    participant FE as Frontend<br/>(Browser)
    participant Chart as Chart.js
    
    Note over ESP32,Chart: System Initialization
    FE->>BE: GET /api/devices
    BE->>DB: SELECT devices
    DB-->>BE: Device list
    BE-->>FE: JSON devices
    FE->>FE: Create charts for each device
    FE->>BE: GET /api/sensor-data/:id (per device)
    BE->>DB: SELECT historical data
    DB-->>BE: Data points
    BE-->>FE: Historical data
    FE->>Chart: Render initial charts
    FE->>BE: GET /api/alerts
    BE->>DB: SELECT alerts
    DB-->>BE: Alert records
    BE-->>FE: Alerts
    FE->>FE: Display alerts
    FE->>WS: Connect Socket.IO
    WS-->>FE: Connection established
    
    Note over ESP32,Chart: Real-time Data Flow
    ESP32->>BE: POST /api/sensor-data<br/>{accel_x, accel_y, accel_z, battery_voltage}
    BE->>Analyzer: Calculate magnitude & analyze
    Analyzer->>Analyzer: Update baseline, check thresholds
    Analyzer-->>BE: {isAbnormal, severity, baseline}
    BE->>DB: INSERT sensor_data
    
    alt Abnormal Detected
        BE->>DB: INSERT vibration_alerts
    end
    
    BE->>BE: Cache battery voltage (in-memory)
    BE->>WS: emit('sensor_data', data)
    WS->>FE: Broadcast to clients
    FE->>FE: Append to deviceDataStore
    FE->>Chart: Update chart with new point
    FE->>FE: Update battery display
    FE->>FE: Check for gaps > 12min
    FE->>Chart: Update disconnection zones (red)
    BE-->>ESP32: Response {success, magnitude, is_abnormal}
    
    Note over ESP32,Chart: Auto-Refresh (every 30s)
    FE->>FE: Auto-refresh timer fires
    alt Socket Disconnected
        FE->>BE: GET /api/sensor-data/:id?since=LAST_TIME
        BE->>DB: SELECT new data points
        DB-->>BE: Incremental data
        BE-->>FE: New points
        FE->>Chart: Update charts
    end
    FE->>BE: GET /api/alerts
    BE->>DB: SELECT recent alerts
    DB-->>BE: Alert records
    BE-->>FE: Updated alerts
    FE->>FE: Refresh alerts display
```

---

## Chú Thích Kỹ Thuật

### Backend Components:
- **Express.js**: Web framework xử lý HTTP/HTTPS requests
- **SQLite**: Database lưu trữ dữ liệu cảm biến, thiết bị và cảnh báo
- **Socket.IO**: Real-time bidirectional communication
- **VibrationAnalyzer**: Class phân tích dữ liệu rung động với thuật toán:
  - Moving average baseline (50 samples)
  - Abnormal threshold: 1.5x baseline
  - Spike detection: 2.0x baseline
  - High-frequency pattern: variance > 0.3 × mean
  - Severity levels: CRITICAL (>3x), HIGH (>2x), MEDIUM (>1.5x), LOW

### Frontend Components:
- **Chart.js**: Library vẽ biểu đồ thời gian thực
- **Socket.IO Client**: Nhận dữ liệu real-time từ backend
- **deviceDataStore**: In-memory store lưu trữ dữ liệu theo device (tối ưu render)
- **Disconnection Plugin**: Custom Chart.js plugin để vẽ vùng đỏ cho các khoảng mất kết nối > 12 phút
- **Auto-refresh**: Polling mechanism (30s) làm backup khi Socket.IO disconnect

### Data Flow:
1. **ESP32 → Backend**: HTTP POST với dữ liệu gia tốc kế và điện áp pin
2. **Backend Processing**: Tính toán magnitude, phân tích bất thường, lưu DB, emit Socket.IO
3. **Backend → Frontend**: Real-time qua Socket.IO hoặc HTTP polling
4. **Frontend Rendering**: Update charts, hiển thị cảnh báo, phát hiện mất kết nối
