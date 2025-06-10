require("dotenv").config();
const express = require("express");
const app = express(); //app is your main web application object
const mongoose = require("mongoose"); // mongoose: For database interaction with MongoDB.
const path = require("path"); //path: Helps to manage file paths in your project.
const session = require("express-session"); //session: Manage user sessions (like login info).
const methodOverride = require("method-override");  //methodOverride: Allows HTTP verbs PUT and DELETE from forms (which only support GET/POST).
const bcrypt = require("bcrypt");//bcrypt: For hashing passwords securely.
const nodemailer = require("nodemailer"); //nodemailer: Send emails (e.g., for OTP).
const expressLayouts = require("express-ejs-layouts"); //expressLayouts: Help manage EJS layouts so you can have a common header/footer.

const Note = require("./models/notes");
const User = require("./models/user");  //These are your Mongoose models representing collections (tables) in your MongoDB.
const OTP = require("./models/otp");
const asyncWrap = require("./utils/asyncWrap");
const ExpressError = require("./ExpressError");

// Database Connection
mongoose.connect("mongodb://127.0.0.1:27017/noteapp")
  .then(() => console.log("DB Connected"))  //Connect your app to your local MongoDB server.
  .catch(err => console.log(err));

// App Config
app.set("view engine", "ejs"); //Use EJS to create HTML views.
app.set("views", path.join(__dirname, "views")); //Views folder is at project-root/views.
app.use(expressLayouts);  //Use express-ejs-layouts so all views can share a common layout.
app.set("layout", "partials/layout"); //The main layout file is views/partials/layout.ejs.
app.use(express.urlencoded({ extended: true }));  //express.urlencoded() allows your app to get form data from req.body
app.use(methodOverride("_method"));  //methodOverride allows you to simulate HTTP PUT and DELETE requests via a query parameter _method. Example: a form with method="POST" can be treated as PUT by adding ?_method=PUT
app.use(express.static(path.join(__dirname, "public"))); //Make everything in the public folder accessible (CSS, JS, images).

// Session Setup
app.use(session({ // Sessions store user data on server, linked to client via cookie.
  secret: "notesecretkey", //secret: a random key used to encrypt session cookies
  resave: false, //resave: false: don’t save session if nothing changed.
  saveUninitialized: false, //saveUninitialized: false: don’t save empty sessions.
  cookie: { maxAge: 1000 * 60 * 60 } // 1 hour cookie.maxAge: how long the session cookie stays valid (here, 1 hour).
}));

// Make locals available in all templates
app.use((req, res, next) => { //Middleware runs for every request.
  res.locals.userId = req.session.userId || null;  //Sets userId in res.locals — this means in your EJS files, you can directly use userId to check if user is logged in.
  next();  //If no logged-in user, userId is null.
});

// Nodemailer Transport Setup
console.log("GMAIL_USER:", process.env.GMAIL_USER);
console.log("GMAIL_APP_PASSWORD:", process.env.GMAIL_APP_PASSWORD);

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

// Middleware: Require Login
function requireLogin(req, res, next) {  //This function is middleware you add to routes to check if user is logged in.
  if (!req.session.userId) return res.redirect("/login"); //Checks if req.session.userId exists (means user logged in).  If not logged in, redirects to /login page.
 next();//If logged in, calls next() to move on to the next middleware or route handler.
}

// Home
app.get("/", (req, res) => res.redirect("/notes"));

// Notes Routes
app.get("/notes", requireLogin, asyncWrap(async (req, res) => {
  const notes = await Note.find({ user: req.session.userId });
  res.render("notes/index.ejs", { notes });
}));


// Show form to create new note
app.get("/notes/new", requireLogin, (req, res) => {
  res.render("notes/new");
});

// Create new note for logged-in user
app.post("/notes", requireLogin, asyncWrap(async (req, res) => {
  const { title, content } = req.body;
  const note = new Note({
    title,
    content,
    user: req.session.userId  // associate note with user
  });
  await note.save();
  res.redirect("/notes");
}));

app.get("/notes/:id", requireLogin, asyncWrap(async (req, res) => {
  try {
    const note = await Note.findOne({ _id: req.params.id, user: req.session.userId });
    
    if (!note) {
      return res.status(404).render("404", { message: "Note not found!" });
    }

    console.log('Note:', note);
    res.render("notes/show", { note });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
}));


// Edit note page - Only if it belongs to the logged-in user
app.get("/notes/:id/edit", requireLogin, asyncWrap(async (req, res) => {
  const note = await Note.findOne({ _id: req.params.id, user: req.session.userId });
  if (!note) {
    return res.status(404).render("404", { message: "Note not found!" });
  }
  res.render("notes/edit", { note });
}));

// Update note - Only if it belongs to the logged-in user
app.put("/notes/:id", requireLogin, asyncWrap(async (req, res) => {
  const { title, content } = req.body;
  const note = await Note.findOneAndUpdate(
    { _id: req.params.id, user: req.session.userId },
    { title, content },
    { new: true }
  );
  if (!note) {
    return res.status(404).render("404", { message: "Note not found!" });
  }
  res.redirect("/notes");
}));

// Delete note - Only if it belongs to the logged-in user
app.delete("/notes/:id", requireLogin, asyncWrap(async (req, res) => {
  const note = await Note.findOneAndDelete({ _id: req.params.id, user: req.session.userId });
  if (!note) {
    return res.status(404).render("404", { message: "Note not found!" });
  }
  res.redirect("/notes");
}));


// Signup
app.get("/signup", (req, res) => res.render("auth/signup"));

app.post("/signup", asyncWrap(async (req, res) => {
  const { email } = req.body;
  const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

  await OTP.create({ userIdentifier: email, otp: otpCode, createdAt: new Date() });

  await transporter.sendMail({
    from: `"NoteApp" <${process.env.GMAIL_USER}>`,
    to: email,
    subject: "Your OTP Code",
    text: `Your OTP is ${otpCode}.`
  });

  req.session.userIdentifier = email;
  console.log("✅ Signup - Session userIdentifier set to:", req.session.userIdentifier);

  // 📌 Important: Save session before redirecting
  req.session.save((err) => {
    if (err) {
      console.error("❌ Error saving session:", err);
      return res.send("Session error");
    }
    console.log("💾 Session saved successfully");
    res.redirect("/verify-otp");
  });
}));


// Verify OTP
app.get("/verify-otp", (req, res) => {
  console.log("📝 GET /verify-otp → session userIdentifier:", req.session.userIdentifier);
  res.render("auth/verify-otp");
});


app.post("/verify-otp", asyncWrap(async (req, res) => {
  console.log("🔍 Incoming OTP Verification Request");

  // Log entire request body
  console.log("📦 req.body:", req.body);

  const { otp } = req.body;
  const email = req.session.userIdentifier;

  console.log("📧 Session Email:", email);
  console.log("🔢 Entered OTP:", otp);

  if (!email) {
    console.log("⚠️ No session email found!");
    return res.send("Session expired or email not found.");
  }

  const otpRecords = await OTP.find({ userIdentifier: email }).sort({ createdAt: -1 });
  console.log("📜 All OTP records for this email:", otpRecords);

  if (otpRecords.length === 0) return res.send("No OTP record found.");

  const latestOtp = otpRecords[0];
  console.log("✅ Latest OTP from DB:", latestOtp.otp);

  if (latestOtp.otp !== otp) {
    console.log("❌ OTP Mismatch");
    return res.send("Invalid OTP");
  }

  await OTP.deleteOne({ _id: latestOtp._id });
  console.log("🗑️ OTP record deleted");

  req.session.tempUserIdentifier = email;
  console.log("🎉 OTP verified, session updated");

  res.redirect("/set-password");
}));



// Set Password
app.get("/set-password", (req, res) => res.render("auth/set-password"));

app.post("/set-password", asyncWrap(async (req, res) => {
  const { password } = req.body;
  const hashed = await bcrypt.hash(password, 12);
  const user = new User({ email: req.session.tempUserIdentifier, password: hashed });
  await user.save();

  req.session.userId = user._id;
  res.redirect("/notes");
}));

// Login
app.get("/login", (req, res) => res.render("auth/login"));

app.post("/login", asyncWrap(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user) return res.send("No user");

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.send("Invalid Password");

  req.session.userId = user._id;
  res.redirect("/notes");
}));

// Logout
app.get("/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/login");
});

// 404 Handler
app.use((req, res) => res.status(404).render("404", { message: "Page not found!" }));

// Error Handler
app.use((err, req, res, next) => {
  console.error(err);
  const { status = 500, message = "Something went wrong!" } = err;
  res.status(status).render("404", { message });
});

// Server Start
app.listen(8080, () => console.log("Server running on 8080"));
