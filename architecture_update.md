# Architecture Overview (Updated)

This diagram reflects the latest system logic, including:
1.  **Heartbeat Optimization**: 0-byte payload, extracting address from BLE headers.
2.  **FFT High-Speed Data**: Using ESP-NOW for bulk transfer (implied from recent optimization tasks) or Fragmented BLE Mesh (if that was the final decision, but ESP-NOW was discussed for reliability). *Self-correction: Recent history mentions "Implement reliable ESP-NOW communication for FFT". So ESP-NOW is the path.*
3.  **SPI Communication**: The "Double SET only if recent GET" logic between Gateway and Host.
4.  **BLE 5.0**: Use of 2M PHY for improved throughput/efficiency.

```mermaid
graph TD
    %% Subsystems
    classDef node fill:#e1f5fe,stroke:#01579b,stroke-width:2px;
    classDef gw fill:#fff9c4,stroke:#fbc02d,stroke-width:2px;
    classDef host fill:#e0f2f1,stroke:#00695c,stroke-width:2px;
    classDef cloud fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px;

    subgraph Sensor_Node [Sensor Node (ESP32)]
        direction TB
        BMI160[BMI160 Sensor]
        FIFO[FIFO Buffer]
        FFT_Proc[FFT Processing]
        
        subgraph Node_Comms [Communication Stack]
            BLE_Mesh_Tx[BLE Mesh (2M PHY)]
            ESPNOW_Tx[ESP-NOW]
        end
        
        BMI160 -->|Raw Data| FIFO
        FIFO -->|Batch Read| FFT_Proc
        FFT_Proc -->|Vibration Data| ESPNOW_Tx
        
        Node_Logic[Node Logic] -->|Heartbeat (0-byte, Header-Address)| BLE_Mesh_Tx
    end
    class Sensor_Node,BMI160,FIFO,FFT_Proc,Node_Comms node

    subgraph Wireless [Wireless Medium]
        Mesh_Air((BLE Mesh Network))
        ESP_Air((ESP-NOW Air))
    end

    BLE_Mesh_Tx -.-> Mesh_Air
    ESPNOW_Tx -.-> ESP_Air

    subgraph Gateway_ESP32 [Gateway (ESP32)]
        direction TB
        GW_Mesh_Rx[BLE Mesh Provisioner]
        GW_ESPNOW_Rx[ESP-NOW Receiver]
        
        GW_Mgr[Gateway Manager]
        SPI_Slave[SPI Slave Interface]

        Mesh_Air -.-> GW_Mesh_Rx
        ESP_Air -.-> GW_ESPNOW_Rx
        
        GW_Mesh_Rx -->|Node Status / Config| GW_Mgr
        GW_ESPNOW_Rx -->|FFT Packets| GW_Mgr
        
        GW_Mgr -->|Queue Data| SPI_Slave
    end
    class Gateway_ESP32,GW_Mesh_Rx,GW_ESPNOW_Rx,GW_Mgr,SPI_Slave gw

    subgraph Host_System [Host (Raspberry Pi / NativeApp)]
        direction TB
        SPI_Master[SPI Master Driver]
        App_Core[Core Application]
        
        SPI_Master <==>|SPI Bus (Data & CMDs)| SPI_Slave
        
        subgraph SPI_Logic [SPI Protocol Logic]
            Poll[GET: Poll Data]
            Config[SET: Send Config]
            DoubleSet[Logic: Double SET only if GET recent]
        end
        
        SPI_Master --- Poll
        SPI_Master --- Config
        
        App_Core -->|Control| SPI_Master
        App_Core -->|Process| Vibration_Analysis
        App_Core -->|Publish| MQTT_Client
    end
    class Host_System,SPI_Master,App_Core,SPI_Logic host

    subgraph Cloud [Cloud / External]
        MQTT_Broker[MQTT Broker]
        Dashboard[Users / Dashboard]
    end
    class Cloud,MQTT_Broker,Dashboard cloud

    MQTT_ClientPayload --> MQTT_Broker
    MQTT_Broker --> Dashboard

    %% Notes
    note1[New: 0-byte Heartbeat, Addr from Header] -.-> BLE_Mesh_Tx
    note2[New: Double SET Reliability Logic] -.-> DoubleSet
    note3[New: ESP-NOW for FFT Reliability] -.-> ESPNOW_Tx
```
