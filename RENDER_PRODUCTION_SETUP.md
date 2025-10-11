# Production Environment Variables for Render

## Required Environment Variables

Add these to your Render dashboard under "Environment" tab:

```env
# Database Configuration (MongoDB Atlas)
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/bagiraa_app

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-for-production-change-this

# Frontend Configuration
FRONTEND_URL=http://localhost:5173

# Session Configuration
SESSION_SECRET=your-super-secret-session-key-for-production-change-this

# Environment
NODE_ENV=production

# Server Configuration
PORT=10000
```

## How to Get MongoDB Atlas Connection String

### Step 1: Create MongoDB Atlas Account
1. Go to [MongoDB Atlas](https://www.mongodb.com/atlas)
2. Sign up for a free account
3. Create a new project

### Step 2: Create Cluster
1. Click "Build a Database"
2. Choose "FREE" tier (M0 Sandbox)
3. Select a region close to your users
4. Name your cluster (e.g., "bagiraa-cluster")
5. Click "Create Cluster"

### Step 3: Create Database User
1. Go to "Database Access" in the left sidebar
2. Click "Add New Database User"
3. Choose "Password" authentication
4. Create a username and strong password
5. Set privileges to "Read and write to any database"
6. Click "Add User"

### Step 4: Whitelist IP Addresses
1. Go to "Network Access" in the left sidebar
2. Click "Add IP Address"
3. Click "Allow Access from Anywhere" (0.0.0.0/0) for development
4. Click "Confirm"

### Step 5: Get Connection String
1. Go to "Database" in the left sidebar
2. Click "Connect" on your cluster
3. Choose "Connect your application"
4. Select "Node.js" as driver
5. Copy the connection string
6. Replace `<password>` with your database user password
7. Replace `<dbname>` with your database name (e.g., "bagiraa_app")

### Example Connection String:
```
mongodb+srv://bagiraa_user:your_password@bagiraa-cluster.abc123.mongodb.net/bagiraa_app?retryWrites=true&w=majority
```

## Security Notes

### For Production:
1. **Change default passwords** - Use strong, unique passwords
2. **Restrict IP access** - Only allow Render's IP ranges in MongoDB Atlas
3. **Use environment variables** - Never hardcode credentials
4. **Enable MongoDB Atlas security features** - Enable authentication and encryption

### Render IP Whitelist:
Add these IP ranges to MongoDB Atlas Network Access:
- `0.0.0.0/0` (for development - allows all IPs)
- Or specific Render IP ranges for production

## Testing the Connection

After setting up MongoDB Atlas and updating Render environment variables:

1. **Redeploy your Render service**
2. **Check Render logs** - Should see "MongoDB connected successfully"
3. **Test your frontend** - Login should work with cloud database

## Troubleshooting

### Common Issues:
1. **Connection timeout** - Check MongoDB Atlas IP whitelist
2. **Authentication failed** - Verify username/password in connection string
3. **Database not found** - Ensure database name exists in connection string

### Render Logs to Check:
- Look for "MongoDB connected successfully"
- Check for any MongoDB connection errors
- Verify environment variables are set correctly
