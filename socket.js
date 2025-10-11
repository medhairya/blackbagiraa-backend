const socket = require('socket.io');

let io;

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
    
    io.on('connection', (socket) => {
        console.log(`Socket.IO connection established - ID: ${socket.id}, Origin: ${socket.handshake.headers.origin || 'No Origin'}`);
        
        // Handle disconnection
        socket.on('disconnect', (reason) => {
            console.log(`Socket.IO disconnected - ID: ${socket.id}, Reason: ${reason}`);
        });
    });
    
    return io;
};

const getIo=()=>{
    if(!io){
        throw new Error("Socket not initialized");
    }
    return io;
}

module.exports = {initializeSocket,getIo};
