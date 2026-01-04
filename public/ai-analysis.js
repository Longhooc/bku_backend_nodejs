// AI Analysis Module - Per Device Integration
// Phân tích AI tích hợp trực tiếp vào mỗi card thiết bị

// Analyze vibration with AI for a specific device and selected FFT events
async function analyzeDeviceVibration(deviceId, selectedTimestamps = null, buttonElement = null) {
    const loadingMsg = buttonElement ? buttonElement.textContent : '';

    try {
        // Show loading state
        if (buttonElement) {
            buttonElement.disabled = true;
            buttonElement.textContent = '⏳ Đang phân tích...';
        }

        // Get FFT analysis data
        console.log(`🤖 Analyzing device ${deviceId}, selected events:`, selectedTimestamps);
        const limit = 50; // Get more data to filter
        const response = await fetch(`/api/analyze-vibration?device_id=${deviceId}&limit=${limit}`);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        const analysisData = await response.json();

        if (!analysisData || analysisData.length === 0) {
            return {
                success: false,
                message: '⚠️ Không tìm thấy dữ liệu FFT.\nLưu ý: Hệ thống chỉ lưu FFT khi phát hiện rung động bất thường.'
            };
        }

        // Filter for selected events if provided
        let dataToAnalyze = analysisData;
        if (selectedTimestamps && selectedTimestamps.length > 0) {
            // Normalize timestamps for comparison (handle both "YYYY-MM-DD HH:MM:SS" and "YYYY-MM-DDTHH:MM:SS+07:00" formats)
            const normalizeTimestamp = (ts) => {
                // Remove timezone and replace T with space for consistent comparison
                return ts.replace('T', ' ').split('+')[0].split('.')[0];
            };

            const normalizedSelected = selectedTimestamps.map(normalizeTimestamp);

            dataToAnalyze = analysisData.filter(d => {
                const normalizedData = normalizeTimestamp(d.timestamp);
                return normalizedSelected.includes(normalizedData);
            });

            console.log('🔍 Filtered events:', {
                selected: normalizedSelected,
                found: dataToAnalyze.map(d => normalizeTimestamp(d.timestamp)),
                totalAvailable: analysisData.length
            });

            if (dataToAnalyze.length === 0) {
                return {
                    success: false,
                    message: `⚠️ Không tìm thấy dữ liệu FFT cho các sự kiện đã chọn.\n\nĐã chọn: ${selectedTimestamps.length} events\nTìm thấy: 0 events\nTổng có sẵn: ${analysisData.length} events`
                };
            }
        } else {
            // If no selection, use recent 10
            dataToAnalyze = analysisData.slice(0, 10);
        }

        // Validate FFT data
        const validData = dataToAnalyze.filter(d => d.fft && d.fft.length > 0);
        if (validData.length === 0) {
            return {
                success: false,
                message: '⚠️ Dữ liệu không chứa thông tin FFT hợp lệ.'
            };
        }

        // Construct AI prompt
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

        // Call Google Gemini API
        const geminiApiKey = 'AIzaSyCMrOCYVvUkn-wsCM-KxgpjE_ZV0QuOvdM';
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${geminiApiKey}`;

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
            throw new Error(`Gemini API error: ${geminiResponse.status}`);
        }

        const geminiResult = await geminiResponse.json();
        const aiText = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text || 'Không nhận được kết quả từ AI';

        return {
            success: true,
            message: aiText
        };

    } catch (error) {
        console.error('❌ AI Analysis error:', error);
        return {
            success: false,
            message: `❌ Lỗi: ${error.message}\n\nVui lòng kiểm tra:\n1. Kết nối internet\n2. API key Gemini\n3. Server đang chạy`
        };
    } finally {
        if (buttonElement) {
            buttonElement.disabled = false;
            buttonElement.textContent = loadingMsg;
        }
    }
}

// Show analysis result in a modal or embedded div
function showAnalysisResult(deviceId, result) {
    const resultDiv = document.getElementById(`ai_result_${deviceId}`);
    if (!resultDiv) return;

    resultDiv.style.display = 'block';
    const contentDiv = resultDiv.querySelector('.ai-result-content');
    if (contentDiv) {
        if (result.success) {
            // Render markdown first
            let htmlContent = result.message;

            // Check if marked is available
            if (typeof marked !== 'undefined') {
                try {
                    htmlContent = marked.parse(result.message);
                } catch (e) {
                    console.warn('Markdown parsing failed:', e);
                }
            }

            contentDiv.innerHTML = htmlContent;
            contentDiv.style.color = '#2d3748';

            // Render LaTeX math if KaTeX is available
            if (typeof renderMathInElement !== 'undefined') {
                try {
                    renderMathInElement(contentDiv, {
                        delimiters: [
                            { left: '$$', right: '$$', display: true },
                            { left: '$', right: '$', display: false },
                            { left: '\\[', right: '\\]', display: true },
                            { left: '\\(', right: '\\)', display: false }
                        ],
                        throwOnError: false
                    });
                } catch (e) {
                    console.warn('LaTeX rendering failed:', e);
                }
            }
        } else {
            // Error message - display as plain text
            contentDiv.textContent = result.message;
            contentDiv.style.color = '#f56565';
        }
    }
}

// Get selected FFT timestamps for a device
function getSelectedFFTTimestamps(deviceId) {
    const checkboxes = document.querySelectorAll(`.fft_checkbox_${deviceId}:checked`);
    return Array.from(checkboxes).map(cb => cb.dataset.timestamp);
}

// Update selected count display
function updateSelectedCount(deviceId) {
    const selectedCount = document.querySelectorAll(`.fft_checkbox_${deviceId}:checked`).length;
    const totalCount = document.querySelectorAll(`.fft_checkbox_${deviceId}`).length;
    const countEl = document.getElementById(`selected_count_${deviceId}`);
    if (countEl) {
        countEl.textContent = `${selectedCount}/${totalCount} đã chọn`;
    }

    // Update select all checkbox state
    const selectAllCheckbox = document.getElementById(`select_all_${deviceId}`);
    if (selectAllCheckbox) {
        selectAllCheckbox.checked = selectedCount === totalCount && totalCount > 0;
        selectAllCheckbox.indeterminate = selectedCount > 0 && selectedCount < totalCount;
    }
}

// Toggle select all FFT events
function toggleSelectAllFFT(deviceId) {
    const selectAllCheckbox = document.getElementById(`select_all_${deviceId}`);
    const checkboxes = document.querySelectorAll(`.fft_checkbox_${deviceId}`);

    checkboxes.forEach(cb => {
        cb.checked = selectAllCheckbox.checked;
    });

    updateSelectedCount(deviceId);
}

// Create AI analysis section for a device card
function createDeviceAISection(deviceId) {
    const section = document.createElement('div');
    section.style.cssText = 'margin-top: 20px; padding: 15px; background: #f7fafc; border-radius: 8px;';

    const title = document.createElement('h5');
    title.textContent = '🤖 Phân Tích AI';
    title.style.cssText = 'color: #4a5568; margin-bottom: 10px; font-size: 1rem;';

    // FFT Events list
    const eventsContainer = document.createElement('div');
    eventsContainer.id = `fft_events_${deviceId}`;
    eventsContainer.style.cssText = 'margin-bottom: 15px;';

    const eventsTitle = document.createElement('div');
    eventsTitle.textContent = '📊 Các sự kiện FFT (Trigger):';
    eventsTitle.style.cssText = 'font-weight: 600; color: #4a5568; margin-bottom: 8px; font-size: 0.9rem;';

    const eventsList = document.createElement('div');
    eventsList.id = `fft_list_${deviceId}`;
    eventsList.style.cssText = 'max-height: 250px; overflow-y: auto; margin-bottom: 10px;';
    eventsList.innerHTML = '<div style="color: #666; font-size: 0.85rem;">Đang tải...</div>';

    eventsContainer.appendChild(eventsTitle);
    eventsContainer.appendChild(eventsList);

    // Analyze selected button
    const analyzeBtn = document.createElement('button');
    analyzeBtn.id = `analyze_btn_${deviceId}`;
    analyzeBtn.textContent = '🚀 Phân Tích Đã Chọn';
    analyzeBtn.style.cssText = `
        padding: 10px 20px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        border: none;
        border-radius: 6px;
        font-size: 0.9rem;
        font-weight: 600;
        cursor: pointer;
        transition: transform 0.2s;
        margin-bottom: 15px;
    `;
    analyzeBtn.addEventListener('click', async () => {
        const selectedTimestamps = getSelectedFFTTimestamps(deviceId);
        if (selectedTimestamps.length === 0) {
            alert('Vui lòng chọn ít nhất một sự kiện FFT để phân tích!');
            return;
        }
        const result = await analyzeDeviceVibration(deviceId, selectedTimestamps, analyzeBtn);
        showAnalysisResult(deviceId, result);
    });

    // Result display
    const resultDiv = document.createElement('div');
    resultDiv.id = `ai_result_${deviceId}`;
    resultDiv.style.cssText = 'display: none; margin-top: 15px; padding: 15px; background: white; border-radius: 6px; border: 2px solid #e2e8f0;';

    const resultTitle = document.createElement('h6');
    resultTitle.textContent = '📊 Kết quả phân tích:';
    resultTitle.style.cssText = 'color: #4a5568; margin-bottom: 10px; font-size: 0.95rem;';

    const resultContent = document.createElement('div');
    resultContent.className = 'ai-result-content';
    resultContent.style.cssText = 'color: #2d3748; line-height: 1.8; font-size: 0.9rem; margin: 0; overflow-x: auto;';

    resultDiv.appendChild(resultTitle);
    resultDiv.appendChild(resultContent);

    section.appendChild(title);
    section.appendChild(eventsContainer);
    section.appendChild(analyzeBtn);
    section.appendChild(resultDiv);

    return section;
}

// Load FFT events for a device
async function loadFFTEvents(deviceId) {
    try {
        const response = await fetch(`/api/fft-data/${deviceId}?limit=20`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const result = await response.json();
        const events = result.data || [];

        const listDiv = document.getElementById(`fft_list_${deviceId}`);
        if (!listDiv) return;

        if (events.length === 0) {
            listDiv.innerHTML = '<div style="color: #666; font-size: 0.85rem; font-style: italic;">Chưa có sự kiện FFT nào được ghi nhận.</div>';
            return;
        }

        // Add select all checkbox header
        let html = `
            <div style="display: flex; align-items: center; padding: 8px; margin-bottom: 8px; background: #e6f2ff; border-radius: 4px; border: 1px solid #b3d9ff;">
                <input 
                    type="checkbox" 
                    id="select_all_${deviceId}"
                    onchange="toggleSelectAllFFT('${deviceId}')"
                    style="margin-right: 8px; cursor: pointer; width: 18px; height: 18px;">
                <label for="select_all_${deviceId}" style="cursor: pointer; font-size: 0.9rem; font-weight: 600; color: #2d3748;">
                    ✅ Chọn tất cả
                </label>
                <span id="selected_count_${deviceId}" style="margin-left: auto; font-size: 0.8rem; color: #666; font-weight: 600;">0/${events.length} đã chọn</span>
            </div>
        `;

        html += events.map(event => {
            const timestamp = new Date(event.timestamp);
            const timeStr = timestamp.toLocaleString('vi-VN');

            return `
                <div style="display: flex; align-items: center; padding: 8px; margin-bottom: 6px; background: white; border-radius: 4px; border: 1px solid #e2e8f0;">
                    <input 
                        type="checkbox" 
                        class="fft_checkbox_${deviceId}"
                        data-timestamp="${event.timestamp}"
                        onchange="updateSelectedCount('${deviceId}')"
                        style="margin-right: 8px; cursor: pointer; width: 16px; height: 16px;">
                    <div style="flex: 1;">
                        <div style="font-size: 0.85rem; color: #2d3748;">
                            <strong>⏰ ${timeStr}</strong>
                        </div>
                        <div style="font-size: 0.75rem; color: #666; margin-top: 2px;">
                            Tần số: ${event.dominant_frequency} Hz | Biên độ: ${event.peak_magnitude?.toFixed(2) || 'N/A'}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        listDiv.innerHTML = html;
        updateSelectedCount(deviceId);

    } catch (error) {
        console.error(`Error loading FFT events for ${deviceId}:`, error);
        const listDiv = document.getElementById(`fft_list_${deviceId}`);
        if (listDiv) {
            listDiv.innerHTML = '<div style="color: #f56565; font-size: 0.85rem;">Lỗi tải dữ liệu FFT</div>';
        }
    }
}

// Make functions globally accessible
window.analyzeDeviceVibration = analyzeDeviceVibration;
window.getSelectedFFTTimestamps = getSelectedFFTTimestamps;
window.updateSelectedCount = updateSelectedCount;
window.toggleSelectAllFFT = toggleSelectAllFFT;

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        analyzeDeviceVibration,
        createDeviceAISection,
        loadFFTEvents,
        getSelectedFFTTimestamps,
        updateSelectedCount,
        toggleSelectAllFFT
    };
}
