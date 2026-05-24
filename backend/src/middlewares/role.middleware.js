export const requireRole = (...roles) => (req, res, next) => {
    const userRoles = req.user?.roles || [];
    const hasRole = roles.some(r => userRoles.includes(r));
    if (!hasRole) {
        return res.status(403).json({
            message: `Requires one of: ${roles.join(", ")}`
        });
    }
    next();
};
