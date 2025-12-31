// AI Analysis Module
// Xử lý phân tích AI và dự đoán lỗi máy

// Populate device list for AI analysis
async function populateAIDeviceList() {
    try {
        const response = await fetch('/api/devices?include_simulated=0');
        if (!response.ok) throw new Error('Failed to load devices');

        const devices = await response.json();
        const select = document.getElementById('aiDeviceSelect');

        // Clear existing options except the first one
        select.innerHTML = '<option value="">-- Chọn thiết bị --</option>';

        devices.forEach(device => {
            const option = document.createElement('option');
            option.value = device.device_id;
            option.textContent = device.device_name || device.device_id;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading devices for AI:', error);
    }
}

// Analyze vibration with AI
async function analyzeVibrationWithAI() {
    const deviceSelect = document.getElementById('aiDeviceSelect');
    const limitInput = document.getElementById('aiRecordLimit');
    const analyzeBtn = document.getElementById('analyzeBtn');
    const resultDiv = document.getElementById('aiResult');
    const resultContent = document.getElementById('aiResultContent');

    const deviceId = deviceSelect.value;
    const limit = parseInt(limitInput.value) || 10;

    if (!deviceId) {
        alert('Vui lòng chọn thiết bị!');
        return;
    }

    // Show loading state
    analyzeBtn.disabled = true;
    analyzeBtn.textContent = '⏳ Đang thu thập dữ liệu...';
    resultDiv.style.display = 'block';
    resultContent.textContent = 'Đang tải dữ liệu từ server...';

    try {
        // Step 1: Get analysis data from server
        console.log(`🤖 Requesting analysis data for ${deviceId}, limit=${limit}`);
        const response = await fetch(`/api/analyze-vibration?device_id=${deviceId}&limit=${limit}`);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        const analysisData = await response.json();
        console.log('📊 Analysis data received:', analysisData);

        if (!analysisData || analysisData.length === 0) {
            resultContent.textContent = '⚠️ Không tìm thấy dữ liệu FFT. \nLưu ý: Hệ thống chỉ lưu FFT khi phát hiện rung động bất thường (Trigger Event).\nHãy thử tạo rung động lớn hơn ngưỡng cảnh báo để kích hoạt Trigger.';
            analyzeBtn.disabled = false;
            analyzeBtn.textContent = '🚀 Phân Tích Ngay';
            return;
        }

        // Validate data has FFT
        const validData = analysisData.filter(d => d.fft && d.fft.length > 0);
        if (validData.length === 0) {
            resultContent.textContent = '⚠️ Dữ liệu tìm thấy nhưng không chứa thông tin FFT.\nCác bản ghi này có thể là dữ liệu cảm biến thường, chưa phải dữ liệu sự kiện Trigger.';
            analyzeBtn.disabled = false;
            analyzeBtn.textContent = '🚀 Phân Tích Ngay';
            return;
        }

        // Step 2: Prepare prompt for AI
        analyzeBtn.textContent = '🤖 Đang phân tích...';
        resultContent.textContent = `Đã nhận ${validData.length} mẫu dữ liệu FFT hợp lệ.\nĐang gửi đến AI để phân tích...`;

        // Construct detailed prompt with context
        const prompt = `Bạn là chuyên gia chẩn đoán rung động máy móc (Vibration Analyst).
Dưới đây là dữ liệu rung động thu thập được từ cảm biến gia tốc (Accelerometer).
THÔNG SỐ KỸ THUẬT:
- Tốc độ lấy mẫu (Sample Rate): 1600 Hz
- Số mẫu FFT (Sample Count): 2048 (1024 bin tần số)
- Đơn vị gia tốc: m/s² (hoặc g)
- Dữ liệu FFT: Là mảng biên độ (amplitude) của các bin tần số, đã được rút gọn để tiết kiệm token.

YÊU CẦU PHÂN TÍCH:
1. Đánh giá tình trạng tổng quan (Bình thường / Cảnh báo / Nguy hiểm) dựa trên VRMS và Peak.
2. Phân tích phổ tần số (FFT) để tìm các đỉnh tần số trội (Dominant Frequencies).
3. Dự đoán các lỗi tiềm ẩn (ví dụ: Mất cân bằng - Unbalance, Lệch trục - Misalignment, Lỗi vòng bi - Bearing Fault, Lỗi bánh răng, Lỏng cơ khí...).
4. Đưa ra khuyến nghị bảo trì cụ thể.

DỮ LIỆU ĐẦU VÀO (JSON):
${JSON.stringify(validData)}
`;

        // Step 3: Call Google Gemini API
        const geminiApiKey = 'AIzaSyCMrOCYVvUkn-wsCM-KxgpjE_ZV0QuOvdM'; // Key của bạn
        // Sử dụng model mới nhất theo yêu cầu user
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${geminiApiKey}`;
        // Note: Nếu user muốn dùng Gemini 2 hoặc 3, họ có thể đổi string ở trên. 
        // Hiện tại để 1.5-flash để đảm bảo chạy ổn định vì tên model 3 preview có thể thay đổi.

        const geminiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: prompt
                    }]
                }]
            })
        });

        if (!geminiResponse.ok) {
            throw new Error(`Gemini API error: ${geminiResponse.status} - ${geminiResponse.statusText}`);
        }

        const geminiResult = await geminiResponse.json();
        console.log('🤖 AI Response:', geminiResult);

        // Extract AI response
        const aiText = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text || 'Không nhận được kết quả từ AI';

        // Display result
        resultContent.textContent = aiText;
        analyzeBtn.textContent = '✅ Phân Tích Hoàn Tất';

        // Reset button after 3 seconds
        setTimeout(() => {
            analyzeBtn.disabled = false;
            analyzeBtn.textContent = '🚀 Phân Tích Ngay';
        }, 3000);

    } catch (error) {
        console.error('❌ AI Analysis error:', error);
        resultContent.textContent = `❌ Lỗi: ${error.message}\n\nVui lòng kiểm tra:\n1. Kết nối internet\n2. API key Gemini\n3. Server đang chạy và có dữ liệu FFT (Trigger thử rung động)`;
        analyzeBtn.disabled = false;
        analyzeBtn.textContent = '🚀 Phân Tích Ngay';
    }
}

// Initialize AI analysis module
function initAIAnalysis() {
    console.log('🤖 Initializing AI Analysis module...');

    // Populate device list
    populateAIDeviceList();

    // Add event listener to analyze button
    const analyzeBtn = document.getElementById('analyzeBtn');
    if (analyzeBtn) {
        analyzeBtn.addEventListener('click', analyzeVibrationWithAI);

        // Add hover effect
        analyzeBtn.addEventListener('mouseenter', function () {
            this.style.transform = 'scale(1.05)';
        });
        analyzeBtn.addEventListener('mouseleave', function () {
            this.style.transform = 'scale(1)';
        });
    }

    console.log('✅ AI Analysis module initialized');
}

// Export for use in main script
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { initAIAnalysis, analyzeVibrationWithAI, populateAIDeviceList };
}
