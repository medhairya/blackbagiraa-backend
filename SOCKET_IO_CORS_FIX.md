# Socket.IO CORS Configuration Fix

## Problem
You were getting this CORS error:
```
Access to XMLHttpRequest at 'https://blackbagiraa-backend.onrender.com/socket.io/?EIO=4&transport=polling&t=vc39ls60' from origin 'http://localhost:5173' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

## Root Cause
Socket.IO has its own CORS configuration that's separate from your main Express CORS setup. The original Socket.IO config was using `origin:'*'` which doesn't work properly with credentialed requests.

## Solution Applied

### 1. Updated Backend Socket.IO Configuration (`backend/socket.js`)
```javascript
const initializeSocket = (server) => {
    // Socket.IO CORS configuration - matches main CORS setup
    const allowedOrigins = [
        process.env.FRONTEND_URL,
        'http://localhost:5173',
        'http://localhost:3000',
        'https://your-frontend-domain.com' // Add your production frontend URL here
    ];

    io = socket(server, {
        cors: {
            origin: function (origin, callback) {
                // Allow requests with no origin (like mobile apps or curl requests)
                if (!origin) return callback(null, true);
                
                if (allowedOrigins.indexOf(origin) !== -1) {
                    console.log('Socket.IO CORS: Allowed origin:', origin);
                    callback(null, true);
                } else {
                    console.log('Socket.IO CORS: Blocked origin:', origin);
                    callback(new Error('Not allowed by Socket.IO CORS'));
                }
            },
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
            credentials: true
        }
    });
    
    // ... rest of socket configuration
};
```

### 2. Updated Frontend Socket.IO Client (`frontend/src/context/SocketContext.jsx`)
```javascript
const socket = io(import.meta.env.VITE_BASE_URL, {
    withCredentials: true,
    transports: ['websocket', 'polling']
});
```

## Key Changes Made

### Backend Changes:
- ✅ **Dynamic origin validation** - Same allowed origins as main CORS
- ✅ **Credentials support** - `credentials: true`
- ✅ **Proper methods** - Includes OPTIONS for preflight requests
- ✅ **Enhanced logging** - Logs allowed/blocked origins
- ✅ **Better connection handling** - Logs connection/disconnection events

### Frontend Changes:
- ✅ **Credentials enabled** - `withCredentials: true`
- ✅ **Transport options** - Explicitly allows both websocket and polling
- ✅ **Uses environment variable** - `VITE_BASE_URL` for Render backend

## Environment Variables Required

### Backend (.env)
```env
FRONTEND_URL=http://localhost:5173
```

### Frontend (.env)
```env
VITE_BASE_URL=https://blackbagiraa-backend.onrender.com
```

## Testing the Fix

1. **Start your backend server**:
   ```bash
   cd backend
   npm run dev
   ```

2. **Start your frontend**:
   ```bash
   cd frontend
   npm run dev
   ```

3. **Check browser console** - You should see:
   ```
   connected to socket
   ```

4. **Check backend logs** - You should see:
   ```
   Socket.IO CORS: Allowed origin: http://localhost:5173
   Socket.IO connection established - ID: [socket-id], Origin: http://localhost:5173
   ```

## For Production Deployment

When deploying to production:
1. Update `FRONTEND_URL` in your Render backend environment variables
2. Update `VITE_BASE_URL` in your frontend environment variables
3. Add your production frontend URL to the allowed origins list in `socket.js`

## Troubleshooting

### If you still get CORS errors:
1. **Check backend logs** for Socket.IO CORS messages
2. **Verify environment variables** are set correctly
3. **Clear browser cache** and reload
4. **Check network tab** in browser dev tools for actual request headers

### Common Issues:
- **Port conflicts** - Make sure backend is running on the correct port
- **Environment variables** - Ensure VITE_BASE_URL points to your Render backend
- **Browser cache** - Clear cache and hard refresh the page

The Socket.IO CORS issue should now be resolved! 🎉
