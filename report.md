# Báo Cáo Triển Khai Hệ Thống Web Server Giám Sát Rung Động Máy Móc

## 1. Giới Thiệu Chung
Hệ thống được xây dựng nhằm mục đích giám sát, thu thập và phân tích dữ liệu rung động từ các thiết bị cảm biến IoT trong thời gian thực. Giải pháp sử dụng kiến trúc Client-Server hiện đại với Node.js làm nền tảng backend và giao diện web tương tác trực quan.

## 2. Triển Khai Backend (Server)
Phần máy chủ (`server.js`) đóng vai trò là trung tâm xử lý dữ liệu với các chức năng chính:

*   **Giao tiếp Thời gian thực & API:** Sử dụng **Express.js** để cung cấp RESTful API cho việc gửi/nhận dữ liệu và **Socket.IO** để truyền tải dữ liệu rung động tức thì (real-time) đến giao diện người dùng mà không cần tải lại trang.
*   **Lưu trữ Dữ liệu:** Tích hợp cơ sở dữ liệu **SQLite** nhẹ và hiệu quả để lưu trữ bền vững dữ liệu cảm biến, thông tin thiết bị và lịch sử cảnh báo. Cơ chế tự động đăng ký (auto-registration) giúp hệ thống dễ dàng mở rộng khi có thiết bị mới kết nối.
*   **Thuật toán Phân tích Rung động Thông minh:**
    *   Hệ thống không chỉ lưu trữ thô mà còn thực hiện phân tích ngay tại server thông qua lớp `VibrationAnalyzer`.
    *   **Dynamic Baseline:** Tính toán đường cơ sở (baseline) dựa trên trung bình trượt (moving average) của dữ liệu gần nhất để thích nghi với trạng thái hoạt động bình thường của máy.
    *   **Phát hiện Bất thường:** Tự động so sánh dữ liệu mới với baseline để phát hiện các mẫu bất thường như vượt ngưỡng (Threshold), gai đột ngột (Spike) hoặc biến động tần số cao (High Frequency).

## 3. Triển Khai Frontend (Web Interface)
Giao diện người dùng (`public/index.html`) được thiết kế tập trung vào trải nghiệm giám sát trực quan:

*   **Dashboard Trực quan:** Hiển thị trạng thái của tất cả các node cảm biến, bao gồm mức pin và trạng thái kết nối.
*   **Biểu đồ Thời gian thực:** Tích hợp **Chart.js** để vẽ đồ thị rung động và đường baseline ngay khi dữ liệu được gửi về, giúp người vận hành dễ dàng nhận biết xu hướng.
*   **Hệ thống Cảnh báo:** Hiển thị danh sách các cảnh báo được phân cấp theo mức độ nghiêm trọng (Critical, High, Medium, Low) dựa trên phân tích từ server.
*   **Tra cứu Lịch sử:** Cho phép người dùng xem lại dữ liệu quá khứ theo các khung thời gian linh hoạt (từ 3 giờ đến 1 năm).

## 4. Kết Luận
Hệ thống đã hoàn thiện quy trình khép kín từ thu thập dữ liệu, phân tích thông minh đến hiển thị trực quan. Việc áp dụng thuật toán baseline động và giao tiếp thời gian thực giúp nâng cao đáng kể khả năng phát hiện sớm các hư hỏng tiềm tàng của máy móc.
