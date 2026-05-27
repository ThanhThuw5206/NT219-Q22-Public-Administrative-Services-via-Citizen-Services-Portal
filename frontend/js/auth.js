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
                setAuth(res.data.token, res.data.user);

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

function updateNav() {
    const navAuth = document.getElementById("navAuth");
    if (!navAuth) return;

    const user = getUser();
    if (user) {
        const role = user.roles[0];
        const dashboard = role === "officer" || role === "admin"
            ? "/officer/dashboard.html"
            : "/citizen/dashboard.html";

        navAuth.innerHTML = `
            <a href="${dashboard}" class="btn btn-sm btn-outline">Dashboard</a>
            <span class="nav-user">${user.full_name} (${role})</span>
            <button onclick="logout()" class="btn btn-sm btn-danger">Đăng xuất</button>
        `;
    } else {
        navAuth.innerHTML = `
            <a href="/login.html" class="btn btn-sm btn-primary">Đăng nhập</a>
            <a href="/register.html" class="btn btn-sm btn-outline">Đăng ký</a>
        `;
    }
}
