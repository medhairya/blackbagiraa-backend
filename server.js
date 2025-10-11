const http = require('http');
const app = require('./app');
const PORT = process.env.PORT || 4000;
const server = http.createServer(app);
const connectDB = require('./db/dbConeect');
const {initializeSocket} = require('./socket');

connectDB();
initializeSocket(server);
server.listen(PORT, () => {
    console.log(`Server is running on port http://localhost:${PORT}`);
});
