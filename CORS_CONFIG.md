# CORS Configuration for Black Bagiraa Backend

## Overview
This backend uses a comprehensive CORS (Cross-Origin Resource Sharing) configuration to securely handle requests from different origins.

## Current Configuration

### Allowed Origins
- `http://localhost:5173` (Local frontend development)
- `http://localhost:3000` (Alternative local development)
- `process.env.FRONTEND_URL` (Configurable via environment variables)

### CORS Features
- ✅ **Dynamic Origin Checking** - Validates each request origin
- ✅ **Credentials Support** - Allows cookies and authentication headers
- ✅ **Multiple HTTP Methods** - Supports GET, POST, PUT, DELETE, OPTIONS
- ✅ **Custom Headers** - Allows Content-Type, Authorization, Cookie headers
- ✅ **Error Handling** - Proper error responses for blocked origins
- ✅ **Request Logging** - Logs all requests with origin information

## Configuration Details

### Environment Variables
```env
FRONTEND_URL=http://localhost:5173
```

### CORS Options
```javascript
const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (mobile apps, curl)
        if (!origin) return callback(null, true);
        
        const allowedOrigins = [
            process.env.FRONTEND_URL,
            'http://localhost:5173',
            'http://localhost:3000',
            'https://your-frontend-domain.com' // Add production URL
        ];
        
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
    optionsSuccessStatus: 200
};
```

## Testing CORS

### Test Endpoints
1. **Root endpoint**: `GET /`
2. **CORS test endpoint**: `GET /api/cors-test`

### Example Test Commands
```bash
# Test allowed origin
curl -H "Origin: http://localhost:5173" http://localhost:4000/api/cors-test

# Test blocked origin (should return 403)
curl -H "Origin: http://malicious-site.com" http://localhost:4000/api/cors-test
```

## Production Deployment

### For Render Deployment
1. Update your environment variables in Render dashboard:
   ```
   FRONTEND_URL=https://your-frontend-domain.com
   ```

2. Add your production frontend URL to the allowed origins list in `app.js`

3. The backend will automatically handle CORS for your production frontend

## Security Features
- ✅ **Origin Validation** - Only allows specific trusted origins
- ✅ **No Wildcard Origins** - Prevents overly permissive CORS
- ✅ **Credential Protection** - Secure handling of authentication
- ✅ **Error Logging** - Logs blocked requests for monitoring
- ✅ **Production Ready** - Environment-based configuration

## Troubleshooting

### Common Issues
1. **CORS Error in Browser**: Check if your frontend URL is in the allowed origins list
2. **Credentials Not Working**: Ensure `credentials: true` is set in your frontend requests
3. **Preflight Requests Failing**: Verify that OPTIONS method is allowed

### Debug Information
The server logs all requests with origin information:
```
2025-10-11T05:48:17.570Z - GET /api/cors-test - Origin: http://localhost:5173
```

### CORS Headers in Response
```
Access-Control-Allow-Origin: http://localhost:5173
Access-Control-Allow-Credentials: true
Vary: Origin
```
