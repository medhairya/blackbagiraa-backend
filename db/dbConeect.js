const mongoose = require('mongoose');
const Product = require('../models/Products.model');
const Admin = require('../models/Admin.model');
const bcrypt = require('bcrypt');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1); // Exit process with failure
  }
};

module.exports = connectDB;

const products = [
  {
    "name": "Black Bagiraa(200 ml)",
    "image": "/bagira1.jpg",
    "MRP": 20,
    "retailPrice": 16,
    "scheme": "Buy 1 Get 1 Free",
    "category": "Energy Drinks"
  },
  {
    "name": "Black Bagiraa(200 ml)",
    "image": "/bagira2.jpg",
    "MRP": 20,
    "retailPrice": 16,
    "scheme": "Buy 1 Get 1 Free",
    "category": "Energy Drinks"
  },
  {
    "name": "Black Bagiraa(200 ml)",
    "image": "/bagira3.jpg",
    "MRP": 20,
    "retailPrice": 16,
    "scheme": "Buy 1 Get 1 Free",
    "category": "Energy Drinks"
  },
  {
    "name": "Black Bagiraa(200 ml)",
    "image": "/bagira4.jpg",
    "MRP": 20,
    "retailPrice": 16,
    "scheme": "Buy 1 Get 1 Free",
    "category": "Energy Drinks"
  },
  {
    "name": "Black Bagiraa(200 ml)",
    "image": "/bagira5.jpg",
    "MRP": 20,
    "retailPrice": 16,
    "scheme": "Buy 1 Get 1 Free",
    "category": "Cold Drinks"
  },
  {
    "name": "Black Bagiraa(200 ml)",
    "image": "/bagira6.jpg",
    "MRP": 20,
    "retailPrice": 16,
    "scheme": "Buy 1 Get 1 Free",
    "category": "Cold Drinks"
  },
  {
    "name": "Black Bagiraa(200 ml)",
    "image": "/bagira7.png",
    "MRP": 20,
    "retailPrice": 16,
    "scheme": "Buy 1 Get 1 Free",
    "category": "Cold Drinks"
  }
];

const insertData = async () => {
  try {
    await Product.insertMany(products);
    console.log('Data inserted successfully');
  } catch (error) {
    console.error('MongoDB connection error:', error);
  }
};
// insertData();

const insertAdmins = async () => {
  const admins = [
    { contactNumber: '8849271902', password: 'ashvin@P' },
    { contactNumber: '8160057140', password: 'Hardik@A' },
    { contactNumber: '9662447873', password: 'dhairya4252' }
  ];

  // Hash passwords manually
  const hashedAdmins = await Promise.all(
    admins.map(async (admin) => ({
      contactNumber: admin.contactNumber,
      password: await bcrypt.hash(admin.password, 10),
    }))
  );

  await Admin.insertMany(hashedAdmins);
  console.log('Admins inserted successfully');
};
// insertAdmins(); // Admin data already exists in database
