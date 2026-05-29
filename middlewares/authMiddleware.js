import jwt from 'jsonwebtoken';

export const protect = (req, res, next) => {
    let token;

    // 1. Check if token exists in headers
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        return res.status(401).json({ message: "Not authorized, no token" });
    }

    try {
        // 2. Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // 3. Attach user info to the request object
        req.user = decoded; 
        next(); // Move to the next middleware or controller
    } catch (error) {
        res.status(401).json({ message: "Token failed" });
    }
};

// 4. Role Authorization Middleware
export const authorize = (...roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.user_type)) {
            return res.status(403).json({ 
                message: `User role ${req.user.user_type} is not authorized to access this route` 
            });
        }
        next();
    };
};