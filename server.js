// All business dates (today / this week / this month, report grouping) are in IST,
// regardless of the host's timezone (Render runs in UTC). Must be set before any Date use.
process.env.TZ = 'Asia/Kolkata';

const http = require('http');
const app = require('./app');
const PORT = process.env.PORT || 4000;
const server = http.createServer(app);
const connectDB = require('./db/dbConeect');
const {initializeSocket} = require('./socket');
const dropStalePricingIndex = require('./scripts/dropStalePricingIndex');

connectDB().then(() => {
    // Run one-time migrations after DB is connected
    dropStalePricingIndex();
});
initializeSocket(server);
server.listen(PORT, () => {
    console.log(`Server is running on port http://localhost:${PORT}`);
});
