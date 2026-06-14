/**
 * auth.js - Xử lý đăng nhập, đăng ký và điều hướng thanh điều hướng.
 * Tự động gắn sự kiện cho form login/register nếu tồn tại trên trang.
 */
document.addEventListener("DOMContentLoaded", () => {
    const loginForm = document.getElementById("loginForm");
    const registerForm = document.getElementById("registerForm");
    const errorEl = document.getElementById("authError");

    if (loginForm) {
        loginForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            if (errorEl) {
                errorEl.textContent = "";
                errorEl.style.display = "none";
            }

            const email = loginForm.email.value.trim();
            const password = loginForm.password.value;

            try {
                const res = await apiPost("/auth/login", { email, password });
                setAuth(null, res.data.user);

                const role = res.data.user.roles[0];
                if (role === "officer" || role === "admin") {
                    window.location.href = "/officer/dashboard.html";
                } else {
                    window.location.href = "/citizen/dashboard.html";
                }
            } catch (err) {
                if (errorEl) {
                    errorEl.textContent = err.message;
                    errorEl.style.display = "block";
                }
            }
        });
    }

    if (registerForm) {
        registerForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            if (errorEl) {
                errorEl.textContent = "";
                errorEl.style.display = "none";
            }

            const full_name = registerForm.full_name.value.trim();
            const email = registerForm.email.value.trim();
            const password = registerForm.password.value;
            const confirm = registerForm.confirm_password.value;

            if (password !== confirm) {
                if (errorEl) {
                    errorEl.textContent = "Mật khẩu xác nhận không khớp";
                    errorEl.style.display = "block";
                }
                return;
            }

            try {
                await apiPost("/auth/register", { full_name, email, password });
                window.location.href = "/login.html?registered=1";
            } catch (err) {
                if (errorEl) {
                    errorEl.textContent = err.message;
                    errorEl.style.display = "block";
                }
            }
        });
    }
});

/**
 * Update navigation based on login state.
 * Uses textContent instead of innerHTML to prevent XSS.
 */
function updateNav() {
    const navAuth = document.getElementById("navAuth");
    const navThutuc = document.getElementById("navThutuc");
    if (!navAuth) return;

    const user = getUser();
    if (user) {
        const role = user.roles[0];
        const dashboardPath = role === "officer" || role === "admin"
            ? "/officer/dashboard.html"
            : "/citizen/dashboard.html";

        if (navThutuc) {
            navThutuc.href = dashboardPath;
        }

        // Clear existing content
        navAuth.textContent = "";

        // Create user info span (safe: textContent prevents XSS)
        const userSpan = document.createElement("span");
        userSpan.className = "nav-user";
        userSpan.textContent = `${user.full_name} (${role})`;

        // Create logout button
        const logoutBtn = document.createElement("button");
        logoutBtn.className = "btn btn-sm btn-danger";
        logoutBtn.textContent = "Đăng xuất";
        logoutBtn.addEventListener("click", logout);

        navAuth.appendChild(userSpan);
        navAuth.appendChild(logoutBtn);
    } else {
        // Clear existing content
        navAuth.textContent = "";

        // Create login link
        const loginLink = document.createElement("a");
        loginLink.href = "/login.html";
        loginLink.className = "btn btn-sm btn-primary";
        loginLink.textContent = "Đăng nhập";

        // Create register link
        const registerLink = document.createElement("a");
        registerLink.href = "/register.html";
        registerLink.className = "btn btn-sm btn-outline";
        registerLink.textContent = "Đăng ký";

        navAuth.appendChild(loginLink);
        navAuth.appendChild(registerLink);
    }
}
