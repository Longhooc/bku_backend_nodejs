const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const https = require('https');
const http = require('http');
const fs = require('fs');
const socketIo = require('socket.io');
const moment = require('moment');

const app = express();
// Prepare HTTPS options first, then create a single HTTPS server used by both Express and Socket.IO
const httpsoptions = {
    key: fs.readFileSync('/etc/letsencrypt/live/axithcl.sytes.net/privkey.pem'),
    cert: fs.readFileSync('/etc/letsencrypt/live/axithcl.sytes.net/fullchain.pem'),
};
const server = https.createServer(httpsoptions, app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;
const HTTP_PORT = process.env.HTTP_PORT || 3001; // Separate HTTP port for specific endpoint

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Database setup
const db = new sqlite3.Database('vibration_data.db');

// Initialize database tables
db.serialize(() => {
    // Table for storing sensor data by device ID
    db.run(`CREATE TABLE IF NOT EXISTS sensor_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        accel_x REAL,
        accel_y REAL,
        accel_z REAL,
        vibration_magnitude REAL,
        is_abnormal INTEGER DEFAULT 0
    )`);

    // Table for storing device information
    db.run(`CREATE TABLE IF NOT EXISTS devices (
        device_id TEXT PRIMARY KEY,
        device_name TEXT,
        location TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_active INTEGER DEFAULT 1
    )`);

    // Table for storing vibration alerts
    db.run(`CREATE TABLE IF NOT EXISTS vibration_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT,
        alert_type TEXT,
        severity TEXT,
        message TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_resolved INTEGER DEFAULT 0
    )`);
});

// Vibration analysis functions
class VibrationAnalyzer {
    constructor() {
        this.baselineData = new Map(); // Store baseline for each device
        this.recentData = new Map(); // Store recent data for trend analysis
    }

    // Calculate vibration magnitude from accelerometer data
    calculateVibrationMagnitude(accelX, accelY, accelZ) {
        return Math.sqrt(accelX * accelX + accelY * accelY + accelZ * accelZ);
    }

    // Detect abnormal vibration patterns
    detectAbnormalVibration(deviceId, vibrationMagnitude, accelData) {
        const currentTime = moment();
        
        // Initialize device data if not exists
        if (!this.baselineData.has(deviceId)) {
            this.baselineData.set(deviceId, {
                baseline: vibrationMagnitude,
                samples: [],
                lastUpdate: currentTime
            });
        }

        if (!this.recentData.has(deviceId)) {
            this.recentData.set(deviceId, []);
        }

        const deviceBaseline = this.baselineData.get(deviceId);
        const recentData = this.recentData.get(deviceId);

        // Add current data to recent data (keep last 50 samples)
        recentData.push({
            timestamp: currentTime,
            magnitude: vibrationMagnitude,
            accel: accelData
        });

        if (recentData.length > 50) {
            recentData.shift();
        }

        // Update baseline (moving average over time)
        if (recentData.length >= 10) {
            const avgMagnitude = recentData.reduce((sum, data) => sum + data.magnitude, 0) / recentData.length;
            deviceBaseline.baseline = avgMagnitude;
            deviceBaseline.lastUpdate = currentTime;
        }

        // Check for abnormal patterns
        const threshold = deviceBaseline.baseline * 1.5; // 50% above baseline
        const isAbnormal = vibrationMagnitude > threshold;

        // Check for sudden spikes
        const isSpike = recentData.length >= 3 && 
                       vibrationMagnitude > deviceBaseline.baseline * 2.0;

        // Check for frequency analysis (simple pattern detection)
        const isHighFrequency = this.detectHighFrequencyPattern(recentData);

        return {
            isAbnormal: isAbnormal || isSpike || isHighFrequency,
            severity: this.calculateSeverity(vibrationMagnitude, deviceBaseline.baseline),
            baseline: deviceBaseline.baseline,
            threshold: threshold
        };
    }

    // Detect high frequency vibration patterns
    detectHighFrequencyPattern(recentData) {
        if (recentData.length < 10) return false;

        // Calculate variance in recent data
        const magnitudes = recentData.slice(-10).map(d => d.magnitude);
        const mean = magnitudes.reduce((sum, val) => sum + val, 0) / magnitudes.length;
        const variance = magnitudes.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / magnitudes.length;
        
        // High variance indicates high frequency changes
        return variance > (mean * 0.3);
    }

    // Calculate severity level
    calculateSeverity(currentMagnitude, baseline) {
        const ratio = currentMagnitude / baseline;
        
        if (ratio > 3.0) return 'CRITICAL';
        if (ratio > 2.0) return 'HIGH';
        if (ratio > 1.5) return 'MEDIUM';
        return 'LOW';
    }
}

const analyzer = new VibrationAnalyzer();

// API Routes

// Reusable handler for sensor data endpoint
function handleSensorDataPost(req, res) {
    console.log('📡 Received POST /api/sensor-data');
    console.log('📦 Request body:', JSON.stringify(req.body, null, 2));
    
    const { device_id, accel_x, accel_y, accel_z, timestamp } = req.body;

    if (!device_id || accel_x === undefined || accel_y === undefined || accel_z === undefined) {
        console.error('❌ Missing required fields:', { device_id, accel_x, accel_y, accel_z });
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    console.log('✅ Valid request fields received');

    // Auto-register device if not exists
    const checkDeviceStmt = db.prepare('SELECT device_id FROM devices WHERE device_id = ?');
    checkDeviceStmt.get([device_id], (err, row) => {
        if (err) {
            console.error('Error checking device:', err);
        } else if (!row) {
            // Device not registered, register it
            const registerStmt = db.prepare(`
                INSERT OR REPLACE INTO devices (device_id, device_name, location)
                VALUES (?, ?, ?)
            `);
            registerStmt.run(device_id, `Node ${device_id}`, 'Unknown');
            console.log(`📱 Auto-registered new device: ${device_id}`);
        }
    });

    const vibrationMagnitude = analyzer.calculateVibrationMagnitude(accel_x, accel_y, accel_z);
    const analysis = analyzer.detectAbnormalVibration(device_id, vibrationMagnitude, { x: accel_x, y: accel_y, z: accel_z });

    // Store data in database with timestamp (to seconds precision)
    // Use local server time in Vietnam timezone (UTC+7)
    const now = new Date();
    // Convert to Vietnam time (UTC+7)
    const vietnamTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const clientTimestamp = vietnamTime.toISOString().replace('T', ' ').substring(0, 19);
    const stmt = db.prepare(`
        INSERT INTO sensor_data (device_id, timestamp, accel_x, accel_y, accel_z, vibration_magnitude, is_abnormal)
        VALUES (?, COALESCE(?, CURRENT_TIMESTAMP), ?, ?, ?, ?, ?)
    `);

    stmt.run(
        device_id,
        clientTimestamp,
        accel_x,
        accel_y,
        accel_z,
        vibrationMagnitude,
        analysis.isAbnormal ? 1 : 0,
        (err) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Database error' });
        }

        // Create alert if abnormal vibration detected
        if (analysis.isAbnormal) {
            const alertStmt = db.prepare(`
                INSERT INTO vibration_alerts (device_id, alert_type, severity, message)
                VALUES (?, ?, ?, ?)
            `);
            
            alertStmt.run(
                device_id,
                'ABNORMAL_VIBRATION',
                analysis.severity,
                `Abnormal vibration detected: ${vibrationMagnitude.toFixed(2)} (baseline: ${analysis.baseline.toFixed(2)})`
            );
        }

        // Emit real-time data to connected clients
        io.emit('sensor_data', {
            device_id,
            timestamp: clientTimestamp || new Date().toISOString(),
            accel_x,
            accel_y,
            accel_z,
            vibration_magnitude: vibrationMagnitude,
            is_abnormal: analysis.isAbnormal,
            severity: analysis.severity,
            baseline: analysis.baseline
        });
        
        console.log('📊 Data stored and emitted:', {
            device_id,
            vibration_magnitude: vibrationMagnitude.toFixed(3),
            is_abnormal: analysis.isAbnormal,
            timestamp: clientTimestamp
        });

        res.json({
            success: true,
            vibration_magnitude: vibrationMagnitude,
            is_abnormal: analysis.isAbnormal,
            severity: analysis.severity
        });
    });

    stmt.finalize();
}

// Receive sensor data from ESP32 (HTTPS app)
app.post('/api/sensor-data', handleSensorDataPost);

// Get historical data for charts
app.get('/api/sensor-data/:device_id', (req, res) => {
    const { device_id } = req.params;
    const { hours = 24, limit = 100000 } = req.query;
    // 1. Tìm timestamp mới nhất của device
    db.get(
        'SELECT MAX(timestamp) as maxTime FROM sensor_data WHERE device_id = ?',
        [device_id],
        (err, row) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Database error' });
            }
            if (!row || !row.maxTime) {
                return res.json({ device_id, data: [] });
            }
            const maxTime = row.maxTime;
            // 2. Lấy dữ liệu từ (maxTime - hours giờ) đến maxTime
            const rangeQuery = `
                SELECT timestamp, accel_x, accel_y, accel_z, vibration_magnitude, is_abnormal
                FROM sensor_data
                WHERE device_id = ?
                  AND timestamp >= datetime(?, '-${hours} hours') 
                  AND timestamp <= ?
                ORDER BY timestamp ASC
                LIMIT ?
            `;
            db.all(rangeQuery, [device_id, maxTime, maxTime, parseInt(limit)], (err2, rows) => {
                if (err2) {
                    console.error('Database error:', err2);
                    return res.status(500).json({ error: 'Database error' });
                }
                res.json({ device_id, data: rows });
            });
        }
    );
});

// Get all devices
app.get('/api/devices', (req, res) => {
    const { include_simulated = '0' } = req.query;
    const query = `
        SELECT d.*, 
               COUNT(sd.id) as data_count,
               MAX(sd.timestamp) as last_data_time
        FROM devices d
        LEFT JOIN sensor_data sd ON d.device_id = sd.device_id
        WHERE d.is_active = 1
        GROUP BY d.device_id
    `;

    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Database error' });
        }

        // Filter out simulated devices unless explicitly included
        let filtered = rows;
        if (include_simulated !== '1') {
            const isSimulated = (d) => {
                const id = (d.device_id || '').toLowerCase();
                const name = (d.device_name || '').toLowerCase();
                return id.startsWith('debug') || id.startsWith('sim') || id.includes('test') ||
                       name.includes('debug') || name.includes('sim') || name.includes('test');
            };
            filtered = rows.filter(d => !isSimulated(d));
        }

        res.json(filtered);
    });
});

// Register new device
app.post('/api/devices', (req, res) => {
    const { device_id, device_name, location } = req.body;

    if (!device_id) {
        return res.status(400).json({ error: 'Device ID is required' });
    }

    const stmt = db.prepare(`
        INSERT OR REPLACE INTO devices (device_id, device_name, location)
        VALUES (?, ?, ?)
    `);

    stmt.run(device_id, device_name || `Device ${device_id}`, location || 'Unknown', (err) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Database error' });
        }

        res.json({ success: true, device_id });
    });

    stmt.finalize();
});

// Get vibration alerts
app.get('/api/alerts', (req, res) => {
    const { device_id, hours = 24 } = req.query;

    let query = `
        SELECT va.*, d.device_name, d.location
        FROM vibration_alerts va
        LEFT JOIN devices d ON va.device_id = d.device_id
        WHERE va.timestamp >= datetime('now', '-${hours} hours')
    `;

    const params = [];
    if (device_id) {
        query += ' AND va.device_id = ?';
        params.push(device_id);
    }

    query += ' ORDER BY va.timestamp DESC';

    db.all(query, params, (err, rows) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Database error' });
        }

        res.json(rows);
    });
});

// Serve main page
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('subscribe_device', (device_id) => {
        socket.join(`device_${device_id}`);
        console.log(`Client ${socket.id} subscribed to device ${device_id}`);
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

// Start HTTPS server (single instance shared with Socket.IO)
server.listen(PORT, () => {
    console.log(`HTTPS Server running at https://localhost:${PORT}`);
});
// Minimal HTTP app exposing only /api/sensor-data
const httpApp = express();
httpApp.use(cors());
httpApp.use(bodyParser.json());
httpApp.post('/api/sensor-data', handleSensorDataPost);

http.createServer(httpApp).listen(HTTP_PORT, () => {
    console.log(`HTTP Server (limited) running at http://localhost:${HTTP_PORT} for /api/sensor-data`);
});
// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down server...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err);
        } else {
            console.log('Database connection closed.');
        }
        process.exit(0);
    });
});
