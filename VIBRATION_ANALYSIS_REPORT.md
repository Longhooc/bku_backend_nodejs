# BÁO CÁO PHÂN TÍCH RUNG ĐỘNG - NODE 4

## 📋 THÔNG TIN CHUNG

- **Thiết bị**: Node 4
- **Ngày phân tích**: 05/01/2026
- **Tốc độ lấy mẫu**: 1600 Hz
- **Số mẫu FFT**: 2048 (1024 bin tần số)
- **Đơn vị vận tốc**: mm/s
- **Tiêu chuẩn đánh giá**: ISO 10816

---

## 📊 DỮ LIỆU ĐO ĐƯỢC

### Gia tốc (Accelerometer):
- **Trục X**: 0.21 m/s²
- **Trục Y**: 0.01 m/s²
- **Trục Z**: 10.09 m/s² (trọng lực + rung động)

### Các chỉ số rung động:
- **VRMS (Vận tốc RMS)**: 0.1661 mm/s
- **Kurtosis**: -0.22
- **Peak**: 0.45 mm/s

---

## 🎯 ĐÁNH GIÁ TỔNG QUAN

### ✅ TÌNH TRẠNG: **BÌNH THƯỜNG (NORMAL)**

#### Phân tích theo ISO 10816:

1. **VRMS = 0.1661 mm/s**
   - ✅ Rất thấp, nằm trong vùng **"Tốt"** (Good)
   - Tiêu chuẩn ISO 10816:
     - Zone A (Good): < 2.3 mm/s ✅
     - Zone B (Acceptable): 2.3 - 7.1 mm/s
     - Zone C (Warning): 7.1 - 18 mm/s
     - Zone D (Critical): > 18 mm/s
   - **Kết luận**: Mức rung động rất thấp, máy hoạt động tốt

2. **Kurtosis = -0.22**
   - ℹ️ Gần với phân phối chuẩn (Normal = 0 cho normalized kurtosis)
   - Không có dấu hiệu shock hoặc impulse bất thường
   - Giá trị âm nhẹ cho thấy phân phối hơi "phẳng" (platykurtic)
   - **Kết luận**: Không có lỗi vòng bi hay va đập bất thường

3. **Peak = 0.45 mm/s**
   - ✅ Giá trị peak thấp, gấp ~2.7 lần VRMS (tỷ lệ chuẩn: 2-3 lần)
   - Không có đỉnh tần số bất thường
   - **Kết luận**: Không có tần số cộng hưởng nguy hiểm

---

## 📈 PHÂN TÍCH PHỔ TỦN SỐ (FFT)

### Tần số trội (Dominant Frequencies):

Dựa trên dữ liệu FFT được cung cấp (rút gọn):

```
Bin tần số    Biên độ (mm/s)    Nhận xét
-----------------------------------------------
Bin 7-8       0.4               Đỉnh nhỏ
Bin 38        0.3               Nhiễu nền
Bin 70        0.4               Đỉnh nhỏ
Bin 20-25     0.2-0.3           Phổ rải đều
```

**Phân tích chi tiết:**

1. **Không có đỉnh trội rõ rệt**
   - Phổ FFT phân bố đều, biên độ < 0.4 mm/s
   - Đây là dấu hiệu tốt, cho thấy:
     - Không có tần số cộng hưởng
     - Không có lỗi mất cân bằng (unbalance)
     - Không có lỗi lệch trục (misalignment)

2. **Tần số quay (Rotation Speed)**
   - Với sample rate = 1600 Hz và FFT size = 2048:
   - Độ phân giải tần số = 1600 / 2048 ≈ 0.78 Hz/bin
   - Không thể xác định chính xác tần số quay vì không có đỉnh 1X (fundamental frequency)

3. **Tần số vòng bi (Bearing Frequencies)**
   - Không phát hiện các tần số đặc trưng của lỗi vòng bi:
     - BPFO (Ball Pass Frequency Outer race)
     - BPFI (Ball Pass Frequency Inner race)
     - BSF (Ball Spin Frequency)
     - FTF (Fundamental Train Frequency)

---

## 🔍 DỰ ĐOÁN LỖI TIỀM ẨN

### ✅ KHÔNG PHÁT HIỆN LỖI NGHIÊM TRỌNG

Dựa trên phân tích, **KHÔNG** có dấu hiệu của các lỗi sau:

1. **❌ Mất cân bằng (Unbalance)**
   - Không có đỉnh tần số 1X (tần số quay)
   - VRMS quá thấp để có lỗi unbalance

2. **❌ Lệch trục (Misalignment)**
   - Không có đỉnh tần số 2X, 3X (bội số tần số quay)
   - Không có biên độ cao ở tần số trục

3. **❌ Lỗi vòng bi (Bearing Fault)**
   - Kurtosis gần 0 (không có impulse)
   - Không có tần số BPFO, BPFI, BSF, FTF

4. **❌ Lỗi bánh răng (Gear Fault)**
   - Không có tần số meshing (GMF - Gear Mesh Frequency)

5. **❌ Lỏng cơ khí (Looseness)**
   - Không có nhiều harmonic bội số
   - Phổ tần số rải đều, không có "modulation"

---

## ⚠️ NHẬN XÉT VÀ LƯU Ý

### Điểm tốt:
1. ✅ VRMS rất thấp (0.1661 mm/s) - Máy hoạt động tốt
2. ✅ Kurtosis gần 0 - Không có shock/impulse
3. ✅ Phổ FFT rải đều - Không có tần số cộng hưởng
4. ✅ Không phát hiện lỗi cơ học

### Điểm cần lưu ý:
1. ℹ️ **Gia tốc trục Z cao (10.09 m/s²)**
   - Có thể do:
     - Cảm biến đặt thẳng đứng (hấp thụ trọng lực g ≈ 9.81 m/s²)
     - Rung động trục Z ≈ 10.09 - 9.81 = 0.28 m/s² (bình thường)
   - **Khuyến nghị**: Xác nhận hướng lắp đặt cảm biến

2. ℹ️ **Không xác định được tần số quay**
   - Cần biết RPM (vòng/phút) của máy để phân tích sâu hơn
   - **Khuyến nghị**: Ghi nhận RPM vận hành khi đo

3. ℹ️ **Dữ liệu FFT bị rút gọn**
   - Chỉ có ~130 bins được hiển thị (trên tổng 1024 bins)
   - **Khuyến nghị**: Phân tích toàn bộ FFT để phát hiện lỗi tần số cao (ví dụ: lỗi vòng bi)

---

## 🛠️ KHUYẾN NGHỊ BẢO TRÌ

### 1. **Bảo trì định kỳ (Routine Maintenance)**

- ✅ **Trạng thái hiện tại**: Tốt, không cần can thiệp khẩn cấp
- 📅 **Lịch kiểm tra tiếp theo**:
  - Theo dõi rung động: **3 tháng**
  - Bảo trì dự phòng: **6 tháng**

### 2. **Theo dõi xu hướng (Trend Monitoring)**

Thiết lập baseline và theo dõi các chỉ số sau:

| Chỉ số | Giá trị hiện tại | Ngưỡng cảnh báo | Ngưỡng nguy hiểm |
|--------|------------------|-----------------|------------------|
| VRMS   | 0.1661 mm/s      | > 2.3 mm/s      | > 7.1 mm/s       |
| Kurtosis | -0.22          | > 5 hoặc < -2   | > 10             |
| Peak   | 0.45 mm/s        | > 5 mm/s        | > 10 mm/s        |

**Hành động khi vượt ngưỡng**:
- **Ngưỡng cảnh báo**: Kiểm tra vòng bi, thắt chặt bu lông, cân bằng rotor
- **Ngưỡng nguy hiểm**: Dừng máy ngay, kiểm tra toàn bộ hệ thống

### 3. **Cải thiện thu thập dữ liệu**

Để phân tích chính xác hơn, cần bổ sung:

1. **Thông tin máy móc**:
   - RPM vận hành
   - Loại vòng bi (để tính BPFO, BPFI, BSF, FTF)
   - Số răng bánh răng (nếu có)
   - Hướng lắp đặt cảm biến (X, Y, Z tương ứng với hướng nào trên máy)

2. **Dữ liệu rung động đầy đủ**:
   - FFT đầy đủ 1024 bins (không rút gọn)
   - Dữ liệu time-domain (waveform) để phân tích dạng sóng

3. **Đo đa điểm**:
   - Đo tại bearing housing (vỏ vòng bi)
   - Đo tại motor casing
   - Đo tại coupling (khớp nối)

### 4. **Bảo trì dự phòng (Preventive Maintenance)**

Mặc dù không phát hiện lỗi, vẫn nên thực hiện:

- ✅ Kiểm tra và bôi trơn vòng bi (6 tháng)
- ✅ Kiểm tra độ chặt bu lông nền móng (6 tháng)
- ✅ Kiểm tra cân bằng rotor (1 năm)
- ✅ Kiểm tra alignment trục (1 năm)
- ✅ Thay vòng bi dự phòng (theo khuyến nghị nhà sản xuất, thường 2-3 năm)

---

## 📊 SO SÁNH VỚI TIÊU CHUẨN

### Bảng đánh giá theo ISO 10816-1:

| Tiêu chuẩn | Phân loại máy | Ngưỡng VRMS | Trạng thái Node 4 |
|------------|---------------|-------------|-------------------|
| ISO 10816-1 | Class I (≤ 15 kW) | < 2.3 mm/s | ✅ Good (0.17 mm/s) |
| ISO 10816-1 | Class II (15-75 kW) | < 2.3 mm/s | ✅ Good (0.17 mm/s) |
| ISO 10816-1 | Class III (75-300 kW) | < 2.8 mm/s | ✅ Good (0.17 mm/s) |
| ISO 10816-1 | Class IV (> 300 kW) | < 4.5 mm/s | ✅ Good (0.17 mm/s) |

**Kết luận**: Node 4 nằm trong vùng **"Good"** cho mọi phân loại máy theo ISO 10816.

---

## 🎯 KẾT LUẬN

### Tóm tắt:

1. **Tình trạng tổng thể**: ✅ **BÌNH THƯỜNG (GOOD)**
2. **VRMS**: 0.1661 mm/s (Rất tốt, < 2.3 mm/s threshold)
3. **Kurtosis**: -0.22 (Bình thường, không có shock)
4. **Peak**: 0.45 mm/s (Thấp, không có tần số cộng hưởng)
5. **Lỗi phát hiện**: ❌ Không có lỗi nghiêm trọng

### Khuyến nghị cuối cùng:

1. ✅ **Tiếp tục vận hành bình thường**
2. 📅 **Theo dõi VRMS định kỳ 3 tháng** để phát hiện xu hướng tăng
3. 🔧 **Bảo trì dự phòng sau 6 tháng** (bôi trơn, kiểm tra bu lông)
4. 📊 **Thu thập thêm dữ liệu**: RPM, FFT đầy đủ, thông tin vòng bi

---

## 📌 PHỤ LỤC

### A. Công thức tính toán

**VRMS (Root Mean Square Velocity)**:
```
VRMS = sqrt(mean(velocity^2))
```

**Kurtosis (Normalized)**:
```
Kurtosis = (E[(X - μ)^4] / σ^4) - 3
```
- Normal distribution: Kurtosis = 0
- High impulsive: Kurtosis > 3
- Low variability: Kurtosis < -1

**Peak**:
```
Peak = max(FFT magnitude)
```

### B. Tần số đặc trưng vòng bi (Cần RPM và thông số vòng bi)

```
BPFO = (N_b / 2) * (1 + (d / D) * cos(φ)) * RPM / 60
BPFI = (N_b / 2) * (1 - (d / D) * cos(φ)) * RPM / 60
BSF  = (D / (2*d)) * (1 - (d / D)^2 * cos^2(φ)) * RPM / 60
FTF  = (1 / 2) * (1 - (d / D) * cos(φ)) * RPM / 60
```

Trong đó:
- N_b: Số bi (balls)
- d: Đường kính bi
- D: Pitch diameter
- φ: Góc tiếp xúc (contact angle)

### C. Định nghĩa các lỗi thường gặp

1. **Unbalance (Mất cân bằng)**:
   - Dấu hiệu: Đỉnh cao tại 1X (tần số quay)
   - Nguyên nhân: Khối lượng rotor không đồng đều
   - Khắc phục: Cân bằng rotor

2. **Misalignment (Lệch trục)**:
   - Dấu hiệu: Đỉnh cao tại 2X, 3X
   - Nguyên nhân: Trục động cơ và thiết bị không thẳng hàng
   - Khắc phục: Cân chỉnh alignment

3. **Bearing Fault (Lỗi vòng bi)**:
   - Dấu hiệu: Kurtosis cao (> 5), tần số BPFO/BPFI
   - Nguyên nhân: Hư hỏng vòng ngoài/trong vòng bi
   - Khắc phục: Thay vòng bi

4. **Looseness (Lỏng cơ khí)**:
   - Dấu hiệu: Nhiều harmonic, phổ rộng
   - Nguyên nhân: Bu lông lỏng, foundation không chắc chắn
   - Khắc phục: Thắt chặt bu lông, gia cố nền móng

---

**Người phân tích**: AI Vibration Analyst (Gemini)  
**Ngày báo cáo**: 05/01/2026  
**Phiên bản**: 1.0  

---

## 📞 Liên hệ

Nếu cần hỗ trợ thêm, vui lòng cung cấp:
1. RPM vận hành của máy
2. Thông số vòng bi (model number)
3. Dữ liệu FFT đầy đủ (1024 bins)
4. Ảnh chụp vị trí lắp đặt cảm biến

**Chúc bạn vận hành an toàn!** 🚀
