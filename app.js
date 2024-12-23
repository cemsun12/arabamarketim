import express from 'express';

// Firebase Authentication
import { auth, db, storage } from './firebaseConfig.js';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';

// Firebase Firestore
import { doc, setDoc } from 'firebase/firestore';
import { query, where, collection, getDocs, getDoc } from 'firebase/firestore';
import { Timestamp } from 'firebase/firestore';

import { v4 as uuidv4 } from 'uuid'; // To generate random IDs
import multer from 'multer'; // For handling file uploads

// Firebase Storage
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

import session from 'express-session';
import axios from 'axios';
import fetch from 'node-fetch';

import fs from 'fs';
import { createReadStream } from 'fs';
import csvParser from 'csv-parser';


const app = express();
const upload = multer({
    storage: multer.memoryStorage(), // Store files in memory
    limits: { fileSize: 2 * 1024 * 1024 }, // Limit file size to 2MB
    fileFilter: (req, file, cb) => {
        const allowedMimeTypes = ['image/jpeg', 'image/png'];
        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true); // Accept the file
        } else {
            cb(new Error('Invalid file type. Only .jpg and .png are allowed.')); // Reject invalid types
        }
    },
});

// Wrap the upload middleware for error handling
const uploadHandler = (req, res, next) => {
    upload.array('images', 10)(req, res, (err) => { // 'images' is the field name; limit to 10 files
        if (err instanceof multer.MulterError) {
            // Multer-specific errors
            return res.status(400).send(`Multer Error: ${err.message}`);
        } else if (err) {
            // Custom errors (like invalid file type)
            return res.status(400).send(`Error: ${err.message}`);
        }

        // Validate file types
        const allowedTypes = ['image/jpeg', 'image/png'];
        const invalidFiles = req.files.filter(file => !allowedTypes.includes(file.mimetype));

        if (invalidFiles.length > 0) {
            return res.status(400).send(`Invalid file types: ${invalidFiles.map(f => f.originalname).join(', ')}`);
        }

        next(); // Proceed to the next middleware if no error
    });
};


let ilIlceData = [];

// Read and parse the CSV file at server startup
fs.createReadStream('il_ilce.csv') // Path to your CSV file
    .pipe(csvParser())
    .on('data', (row) => {
        ilIlceData.push(row);
    })
    .on('end', () => {
        console.log('CSV file successfully processed');
    });

// API to get all 'il' options
app.get('/api/il', (req, res) => {
    const ils = [...new Set(ilIlceData.map(item => item.il))]; // Extract unique 'il'
    res.json(ils);
});

// API to get 'ilce' options based on selected 'il'
app.get('/api/ilce/:il', (req, res) => {
    const il = req.params.il;
    const ilces = ilIlceData
        .filter(item => item.il === il)
        .map(item => item.ilce);
    res.json(ilces);
});

app.use(session({
    secret: 'asunatech', // Use a secure random key here
    resave: false,
    saveUninitialized: true,
}));

app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');

const API_KEY = "7db8b29dc68969ecb79e7acc66ebf5fb";
const BASE_URL = "https://api.wheel-size.com/v2/makes/?user_key=7db8b29dc68969ecb79e7acc66ebf5fb";



// Middleware to check if the user is authenticated
function isAuthenticated(req, res, next) {
    if (req.session.user) {
        return next(); // User is logged in, proceed to the next middleware or route
    } else {
        res.redirect('/lander'); // Redirect to login if not authenticated
    }
}

app.get('/lander', (req, res) => {
    res.render('lander');
});



app.get('/publish-success', (req, res) => {
    res.render('publish-success');
});

app.get('/register', (req, res) => {
    res.render('register');
});

app.get('/login', (req, res) => {
    res.render('login');
});

app.post('/register', upload.fields([
    { name: 'profileImage', maxCount: 1 },
    { name: 'taxPlate', maxCount: 1 },
]), async (req, res) => {
    const { name, surname, email, password, phone, address, accountType, il, ilce } = req.body;
    const profileImage = req.files['profileImage'] ? req.files['profileImage'][0] : null;
    const taxPlate = req.files['taxPlate'] ? req.files['taxPlate'][0] : null;

    const trimmedName = name.trim();
    const trimmedSurname = surname.trim();
    const trimmedEmail = email.trim();
    const trimmedAddress = address.trim();
    const trimmedPhone = phone.trim();
    const trimmedPassword = password.trim();

    if (!trimmedName || !trimmedSurname || !trimmedEmail || !trimmedAddress || !trimmedPhone || !trimmedPassword || !il || !ilce) {
        return res.status(400).send('Tüm alanlar doldurulmalı ve boşluk dışında karakter içermelidir.');
    }

    try {
        // Ensure tax plate is uploaded for corporate accounts
        if (accountType === 'kurumsal' && !taxPlate) {
            throw new Error('Vergi levhası yüklenmesi zorunludur.');
        }

        // Create the user in Firebase Authentication
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        let fotourl = null;
        let taxPlateURL = null;

        // Upload profile image to Firebase Storage
        if (profileImage) {
            const storageRef = ref(storage, `profileImages/${user.uid}/${profileImage.originalname}`);
            const snapshot = await uploadBytes(storageRef, profileImage.buffer);
            fotourl = await getDownloadURL(snapshot.ref);
        }

        // Upload tax plate to Firebase Storage for corporate accounts
        if (taxPlate) {
            const taxPlateRef = ref(storage, `taxPlates/${user.uid}/${taxPlate.originalname}`);
            const taxPlateSnapshot = await uploadBytes(taxPlateRef, taxPlate.buffer);
            taxPlateURL = await getDownloadURL(taxPlateSnapshot.ref);
        }

        // Save user details to Firestore
        const userRef = doc(db, 'users', user.uid);
        await setDoc(userRef, {
            name,
            surname,
            email,
            phone,
            address,
            accountType,
            fotourl,
            taxPlateURL,
            il,
            ilce,
        });

        res.redirect('/');
    } catch (error) {
        console.error('Error registering:', error.message);
        res.status(400).send(`Kayıt başarısız: ${error.message}`);
    }
});



app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // Set session data
        req.session.user = {
            email: user.email,
            uid: user.uid,
        };

        res.redirect('/');
    } catch (error) {
        console.error('Error signing in:', error.message);
        res.send(`<h1>Login Failed: ${error.message}</h1>`);
    }
});

app.get('/years', async (req, res) => {
    const brandSlug = req.query.make;
    const url = `https://api.wheel-size.com/v2/years/?make=${brandSlug}&user_key=${API_KEY}`;
    console.log('Url:', url);
    try {
        const response = await fetch(url);
        const data = await response.json();
        //console.log('Data received for years:', data);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch data' });
    }
});

// Fetch models for a given brand and year
app.get('/models', async (req, res) => {
    const { make, year } = req.query;
    const url = `https://api.wheel-size.com/v2/models/?make=${make}&year=${year}&user_key=${API_KEY}`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch models' });
    }
});

// Fetch modifications for a given brand, year, and model
app.get('/modifications', async (req, res) => {
    const { make, year, model } = req.query;
    const url = `https://api.wheel-size.com/v2/modifications/?make=${make}&year=${year}&model=${model}&user_key=${API_KEY}`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch modifications' });
    }
});

// Fetch search results based on modification
app.get('/search', async (req, res) => {
    const { make, model, modification, year } = req.query;
    const url = `https://api.wheel-size.com/v2/search/by_model/?make=${make}&model=${model}&modification=${modification}&year=${year}&user_key=${API_KEY}`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch search results' });
    }
});

// Handle logout
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.send('Failed to logout');
        }
        res.redirect('/');  // Redirect to login page after logout
    });
});

// Home route with authentication check

app.get("/", async (req, res) => {
    try {
        // Fetch products as before
        const productsRef = collection(db, 'adverts');
        const snapshot = await getDocs(productsRef);
        const products = snapshot.docs.map(doc => {
            const product = doc.data();
            if (product.tarih instanceof Timestamp) {
                const date = product.tarih.toDate();
                product.tarih = formatDate(date);
            }
            if (!product.images) {
                product.images = []; // If no images, make it an empty array
            }
            return product;
        });

        // Fetch car brands
        const response = await axios.get(BASE_URL, {
            headers: { "X-Api-Key": API_KEY },
        });
        const carBrands = response.data.data;

        //console.log("Fetched Car Brands:", carBrands);

        // Fetch the logged-in user's data
        let user = null;
        if (req.session.user) {
            const userRef = doc(db, "users", req.session.user.uid); // Firestore reference
            const userDoc = await getDoc(userRef);

            if (userDoc.exists()) {
                const userData = userDoc.data();
                user = {
                    email: req.session.user.email,
                    uid: req.session.user.uid,
                    fotourl: userData.fotourl || "/images/profile-user.png", // Fallback image
                };
            }
        }

        // Render the page with user data
        res.render("feed", {
            products: products,
            brands: carBrands,
            user: user,
        });
    } catch (error) {
        console.error("Error fetching data:", error.message);
        res.status(500).send("An error occurred while fetching data.");
    }
});

function formatDate(date) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
}


app.get("/tires", isAuthenticated, async (req, res) => {
    const wheelsUrl = `https://api.wheel-size.com/v2/classified/by_rim/search/rim_diameter=19.0&user_key=${API_KEY}`;

    try {
        const response = await axios.get(wheelsUrl, {
            headers: { "X-Api-Key": API_KEY }
        });

        // Log the full API response for debugging
        console.log("API Response:", response.data);

        const tireSizes = response.data?.data || []; // Extract tire sizes
        const formattedTireSizes = tireSizes.map(tire => {
            const width = tire?.width || '';
            const aspectRatio = tire?.aspect_ratio || '';
            const rimDiameter = tire?.rim_diameter || '';
            return `${width}/${aspectRatio} R${rimDiameter}`;
        });

        console.log("Formatted Tire Sizes:", formattedTireSizes);
        res.json(formattedTireSizes);
    } catch (error) {
        console.error("Error fetching tire sizes:", error.message);
        res.status(500).send("An error occurred while fetching tire sizes.");
    }
});







// Protecting models route
app.get('/models/:brand', isAuthenticated, async (req, res) => {
    const brandName = req.params.brand;
    const modelsUrl = `https://api.wheel-size.com/v2/models/?make=${brandName}&user_key=${API_KEY}`;

    try {
        const response = await axios.get(modelsUrl);
        const carModels = response.data.data; // Assuming the models are inside `data`

        console.log("Full API Response:", response.data);

        if (carModels && carModels.length > 0) {
            res.render('models', { brand: brandName, models: carModels });
        } else {
            res.render('models', { brand: brandName, models: [], message: 'No models available for this brand.' });
        }
    } catch (error) {
        console.error("Error fetching car models:", error.message);
        res.status(500).send("An error occurred while fetching car models.");
    }
});

// Protecting years route
app.get('/years/:brand/:model', isAuthenticated, async (req, res) => {
    const brandName = req.params.brand;
    const modelName = req.params.model;

    // Fetch years data as you already do
    const yearsUrl = `https://api.wheel-size.com/v2/years/?make=${brandName}&model=${modelName}&user_key=${API_KEY}`;
    try {
        const response = await axios.get(yearsUrl);
        const carYears = response.data.data;



        // Ensure you pass 'model' into the render
        res.render('years', { brand: brandName, model: { name: modelName }, years: carYears });
    } catch (error) {
        console.error("Error fetching car years:", error.message);
        res.status(500).send("An error occurred while fetching car years.");
    }
});


// Protecting modifications route
app.get('/modifications/:brand/:model/:year', isAuthenticated, async (req, res) => {
    const { brand, model, year } = req.params;

    // Construct the API URL for fetching modifications
    const modificationsUrl = `https://api.wheel-size.com/v2/modifications/?make=${brand}&model=${model}&year=${year}&user_key=${API_KEY}`;

    try {
        const response = await axios.get(modificationsUrl);
        const modifications = response.data.data; // Assuming the data is in the `data` field

        // Log the entire response and modifications data for debugging
        //console.log("Modifications Data:", modifications);

        // Split the modifications into petrol and diesel arrays based on the fuel type
        const petrolModifications = modifications.filter(mod => mod.engine.fuel.toLowerCase() === 'petrol');
        const dieselModifications = modifications.filter(mod => mod.engine.fuel.toLowerCase() === 'diesel');

        // Pass the petrol and diesel modifications to the EJS template
        res.render('modifications', {
            brand,
            model,
            year,
            petrolModifications,
            dieselModifications,
            message: modifications.length ? null : 'No modifications available for this year.'
        });
    } catch (error) {
        console.error("Error fetching modifications:", error.message);
        res.status(500).send("An error occurred while fetching modifications.");
    }
});

// Handle the request when a user clicks on an engine modification
app.get('/modificationDetails/:brand/:model/:year/:modification', isAuthenticated, async (req, res) => {
    const { brand, model, year, modification } = req.params;

    // Replace the API endpoint with the new one
    const modificationUrl = `https://api.wheel-size.com/v2/tires/?user_key=${API_KEY}`;

    try {
        // Fetch data from the new API
        const response = await axios.get(modificationUrl);

        // Log the full response data
        console.log("Full API Response:", response.data);

        // Extract the `data` field from the response
        const modificationDetails = response.data?.data || [];

        // Log the extracted details
        console.log("Modification Details:", modificationDetails);

        // Transform the data into the desired structure
        const modificationInfo = modificationDetails.map((item) => ({
            thumbnail: item?.thumbnail || '/placeholder.svg', // Fallback image if not available
            year: item?.year || year, // Use year from URL param if not available in API
            display: item?.display || 'Unknown Model',
            brand: item?.brand?.name || 'Unknown Brand',
        }));

        // Render the `modificationDetails` view with the fetched data
        res.render('modificationDetails', {
            brand,
            model,
            year,
            modificationInfo,
        });
    } catch (error) {
        // Log the error message and stack trace
        console.error("Error fetching modification details:", error.message);
        console.error(error.stack);

        // Respond with a 500 status and error message
        res.status(500).send("An error occurred while fetching modification details.");
    }
});

app.get('/publish', isAuthenticated, (req, res) => {
    res.render('publish');
});


app.post('/publish', uploadHandler, async (req, res) => {
    try {
        // Validate if files are present
        if (!req.files || req.files.length === 0) {
            throw new Error('No files uploaded.');
        }

        const { title, description, category, usage, type, size, brand, productionYear, loadIndex, speedIndex, price, il, ilce, seller, usedTyre, exchange, condition, adNumber, adDate, address } = req.body;

        const userId = req.session.user ? req.session.user.uid : null;
        if (!userId) {
            throw new Error('User not authenticated');
        }

        const fullAddress = `${address}, ${il} / ${ilce}`;

        const geoLocation = await getGeolocationFromAddress(fullAddress, il, ilce);

        // Step 1: Upload all images to Firebase Storage
        const imageUrls = [];
        for (const file of req.files) {
            // Validate file type
            const allowedTypes = ['image/jpeg', 'image/png'];
            if (!allowedTypes.includes(file.mimetype)) {
                throw new Error(`Invalid file type: ${file.originalname}`);
            }

            const fileExtension = file.mimetype === 'image/png' ? '.png' : '.jpg';
            const imageRef = ref(storage, `advert_fotos/${uuidv4()}${fileExtension}`);
            await uploadBytes(imageRef, file.buffer);

            // Get image URL
            const imageUrl = await getDownloadURL(imageRef);
            imageUrls.push(imageUrl);
        }

        // Step 2: Save data to Firestore
        const adData = {
            title,
            description,
            category,
            usage,
            type,
            size,
            brand,
            productionYear,
            loadIndex,
            speedIndex,
            price,
            il,
            ilce,
            seller,
            usedTyre,
            exchange,
            condition,
            adNumber,
            adDate,
            images: imageUrls, // Store all image URLs as an array
            createdAt: Timestamp.now(),
            userId: userId,
            address: fullAddress,
            location: geoLocation,
        };

        const adRef = doc(db, 'adverts', uuidv4());
        await setDoc(adRef, adData);

        // Step 3: Redirect on success
        res.redirect('/publish-success');
    } catch (error) {
        console.error("Error in /publish:", error.message);
        res.status(400).send(`Error: ${error.message}`);
    }

    async function getGeolocationFromAddress(address, il, ilce) {
        const apiKey = 'AIzaSyBhP60CyBuQgNkoRknONTnLuvcOiZ9RR6U';  // Replace with your Google Maps API Key

        // Log the address being sent for geocoding
        console.log("Geocoding the address:", address);

        // First, try to geocode using the full address
        let fullAddress = address ? address : `${ilce}, ${il}`;
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(fullAddress)}&key=${apiKey}`;

        try {
            const response = await axios.get(url);
            const data = response.data;

            console.log("Geocoding response data:", data); // Log the response data from geocode API

            if (data.status === 'OK') {
                const location = data.results[0].geometry.location;
                console.log("Successfully retrieved geolocation:", location); // Log successful location
                return {
                    latitude: location.lat,
                    longitude: location.lng
                };
            } else {
                console.warn(`Unable to retrieve geolocation for address: ${fullAddress}. Trying fallback with ilce/il.`);
                // Fallback: Try geocoding with ilce (district) and il (city)
                const fallbackAddress = `${ilce}, ${il}`;
                const fallbackUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(fallbackAddress)}&key=${apiKey}`;

                const fallbackResponse = await axios.get(fallbackUrl);
                const fallbackData = fallbackResponse.data;

                console.log("Fallback geocoding response data:", fallbackData); // Log the fallback response data

                if (fallbackData.status === 'OK') {
                    const location = fallbackData.results[0].geometry.location;
                    console.log("Successfully retrieved fallback geolocation:", location); // Log successful fallback location
                    return {
                        latitude: location.lat,
                        longitude: location.lng
                    };
                } else {
                    throw new Error('Unable to retrieve geolocation for the fallback address (ilce/il).');
                }
            }
        } catch (error) {
            console.error("Error fetching geolocation:", error.message);
            throw new Error('Geolocation service error.');
        }
    }

});


// Add this route in app.js
app.get('/product/:adNumber', async (req, res) => {
    const adNumber = req.params.adNumber;
    let user = null;

    try {
        // Fetch product data
        const advertsRef = collection(db, 'adverts');
        const q = query(advertsRef, where('adNumber', '==', adNumber));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            const productDoc = querySnapshot.docs[0];
            const product = productDoc.data();

            if (!product.images) {
                product.images = [];
            }

            // Fetch user data if session exists
            if (req.session.user) {
                const userRef = doc(db, "users", req.session.user.uid);
                const userDoc = await getDoc(userRef);

                if (userDoc.exists()) {
                    const userData = userDoc.data();
                    user = {
                        email: req.session.user.email,
                        uid: req.session.user.uid,
                        fotourl: userData.fotourl || "/images/profile-user.png",
                    };
                }
            }

            // Fetch seller data
            const sellerRef = doc(db, 'users', product.userId);
            const sellerDoc = await getDoc(sellerRef);

            if (sellerDoc.exists()) {
                const seller = sellerDoc.data();
                res.render('product-details', {
                    product,
                    seller,
                    user, // Include user data in the rendering
                });
            } else {
                return res.status(404).send('Seller not found');
            }
        } else {
            return res.status(404).send('Product not found');
        }
    } catch (error) {
        console.error('Error fetching product details:', error);
        return res.status(500).send('An error occurred while fetching product details');
    }
});


app.get('/profile', isAuthenticated, async (req, res) => {
    try {
        // Get the user's UID from the session
        const userId = req.session.user.uid; // Assuming the UID is stored in the session

        // Create a reference to the 'users' document using the modular SDK
        const userRef = doc(db, "users", userId);

        // Fetch the document from Firestore
        const userDoc = await getDoc(userRef);

        // Check if the document exists
        if (!userDoc.exists()) {
            return res.status(404).send('User not found');
        }

        // Retrieve the user data from the document
        const userData = userDoc.data();

        // Pass the user data to the profile page
        res.render('my-profile', {
            user: userData
        });

    } catch (error) {
        console.error('Error fetching user data:', error);
        res.status(500).send('Server error');
    }
});

app.get('/filter-adverts', async (req, res) => {
    const { size } = req.query;
    console.log("Size parameter:", size); // Log the size to check if it's received correctly

    try {
        // Use the new Firestore method to get documents
        const advertsRef = collection(db, 'adverts');  // Use `collection` for querying
        const q = query(advertsRef, where('size', '==', size));  // Apply the `where` clause
        const snapshot = await getDocs(q);  // Fetch the documents based on the query
        const adverts = snapshot.docs.map(doc => doc.data());  // Extract data from documents
        res.json(adverts);  // Send the filtered adverts to the frontend
    } catch (error) {
        console.error('Error fetching filtered adverts:', error);
        res.status(500).send('An error occurred while fetching the filtered adverts.');
    }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
