var express = require("express");
var cors = require("cors");
var path = require("path");
var fs = require("fs");
require("dotenv").config({ path: "./config.env" });

// Native MongoDB driver setup
const { MongoClient, ObjectId } = require("mongodb");
const hasAtlasConfig = process.env.MONGODB_USERNAME && process.env.MONGODB_USERNAME !== "your_username";
const uri = process.env.MONGODB_PREFIX +
    process.env.MONGODB_USERNAME + ":" +
    process.env.MONGODB_PASSWORD +
    process.env.MONGODB_URL;
const client = hasAtlasConfig ? new MongoClient(uri) : null;
const db = client ? client.db(process.env.MONGODB_DB || "GuestbookDB") : null;

// Load local fallback seed data from reviews.json so the server also works immediately before Atlas is configured
let localReviews = JSON.parse(fs.readFileSync(path.resolve(__dirname, "reviews.json"), "utf8"));

var app = express();

app.use(cors());
app.use(express.json());

// Logger Middleware: logs every incoming HTTP request method, URL, and timestamp
app.use(function(request, response, next) {
    console.log("Incoming " + request.method + " request to " + request.url + " [" + new Date().toISOString() + "]");
    next();
});

// Static File Middleware: serves avatar images from staticFiles/ or returns 404 if missing
var publicPath = path.resolve(__dirname, "staticFiles");
app.use("/images", express.static(publicPath));
app.use("/images", function(request, response) {
    response.status(404).send("Image not found!");
});

// Helper function to get all reviews from MongoDB Atlas (or local fallback if Atlas is not yet configured)
async function getAllReviews() {
    if (db) {
        let collection = await db.collection("reviews");
        return await collection.find({}).toArray();
    }
    return localReviews;
}

// GET /reviews: returns all guestbook reviews as JSON
app.get("/reviews", async function(request, response) {
    try {
        let results = await getAllReviews();
        response.send(results);
    } catch (err) {
        response.send(localReviews);
    }
});

// GET /search?q=...: full-stack search across name, role, comment, and rating
app.get("/search", async function(request, response) {
    let searchText = (request.query.q || "").toLowerCase();
    try {
        let allReviews = await getAllReviews();
        let filtered = allReviews.filter(function(review) {
            return String(review.name).toLowerCase().includes(searchText) ||
                   String(review.role).toLowerCase().includes(searchText) ||
                   String(review.comment).toLowerCase().includes(searchText) ||
                   String(review.rating).toLowerCase().includes(searchText);
        });
        response.send(filtered);
    } catch (err) {
        response.status(500).send({ error: "Search failed" });
    }
});

// POST /reviews: saves a new guestbook review to MongoDB Atlas (and local array)
app.post("/reviews", async function(request, response) {
    var body = request.body;
    try {
        if (db) {
            let collection = await db.collection("reviews");
            let result = await collection.insertOne(body);
            response.send(result);
        } else {
            body._id = String(Date.now());
            localReviews.unshift(body);
            response.send({ acknowledged: true, insertedId: body._id });
        }
    } catch (err) {
        response.status(500).send({ error: "Failed to save review" });
    }
});

// PUT /reviews/:_id: updates any attribute of a review (e.g. incrementing likes count)
app.put("/reviews/:_id", async function(request, response) {
    let tempid = request.params._id;
    try {
        if (db && ObjectId.isValid(tempid)) {
            let collection = await db.collection("reviews");
            const query = { _id: new ObjectId(tempid) };
            const updates = { $set: request.body };
            let result = await collection.updateOne(query, updates);
            response.send(result);
        } else {
            for (let i = 0; i < localReviews.length; i++) {
                if (String(localReviews[i]._id) === String(tempid) || String(localReviews[i].id) === String(tempid)) {
                    Object.assign(localReviews[i], request.body);
                }
            }
            response.send({ acknowledged: true, modifiedCount: 1 });
        }
    } catch (err) {
        response.status(500).send({ error: "Failed to update review" });
    }
});

// Final 404 Fallback Middleware
app.use(function(request, response) {
    response.status(404).send("Page not found!");
});

const port = process.env.PORT || 3000;
app.listen(port, function() {
    console.log("Guestbook Backend Server started on port " + port);
});
