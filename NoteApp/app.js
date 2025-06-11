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
  const notes = await Note.find({ user: req.session.userId }); //find all Notes whose user field is equal to the logged-in user’s id (stored in req.session.userId).
  res.render("notes/index.ejs", { notes });
}));


// Show form to create new note
app.get("/notes/new", requireLogin, (req, res) => {
  res.render("notes/new.ejs");
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
    const note = await Note.findOne({ _id: req.params.id, user: req.session.userId });  //_id = req.params.id and user = req.session.userId ensures a user can only view their own notes .If no note is found → 404 page rendered
    
    if (!note) {
      return res.status(404).render("404.ejs", { message: "Note not found!" });//// it does not go to error handller ,handeles error locally

    }

    console.log('Note:', note);
    res.render("notes/show.ejs", { note });
  } catch (err) {    //Use try...catch When you want to handle the error locally (like custom log, response, render) before falling back to the global handler
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
  res.render("notes/edit.ejs", { note });
}));

// Update note - Only if it belongs to the logged-in user
app.put("/notes/:id", requireLogin, asyncWrap(async (req, res) => {
  const { title, content } = req.body;
  const note = await Note.findOneAndUpdate(
    { _id: req.params.id, user: req.session.userId },  //Find a document that matches the filter criteria (in the first argument)
    { title, content }, //Update it with the new values (second argument)
    { new: true }  //Tells Mongoose to return the updated document rather than the original one
  );
  if (!note) {
    return res.status(404).render("404.ejs", { message: "Note not found!" });
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
app.get("/signup", (req, res) => res.render("auth/signup.ejs"));

app.post("/signup", asyncWrap(async (req, res) => {
  const { email } = req.body;
  // 👉 Check if user already exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return res.send("Email already registered. Please login.");
  }
  const otpCode = Math.floor(100000 + Math.random() * 900000).toString(); //Generates a random 6-digit number between 100000 and 999999.Converts it to string since we'll send it via email and store it in DB.

  await OTP.create({ userIdentifier: email, otp: otpCode, createdAt: new Date() });

  await transporter.sendMail({
    from: `"NoteApp" <${process.env.GMAIL_USER}>`,
    to: email,
    subject: "Your OTP Code",
    text: `Your OTP is ${otpCode}.`
  });

  req.session.userIdentifier = email; //It adds or updates a key called userIdentifier in the session for the current user’s session./Saves email into session so you can identify this signup flow when user verifies OTP
  console.log("✅ Signup - Session userIdentifier set to:", req.session.userIdentifier);

  // 📌 Important: Save session before redirecting
  req.session.save((err) => {
    if (err) {  //You set req.session.userIdentifier = email; to store the email.Then you call req.session.save() to immediately persist that change before redirecting — ensuring when the user lands on /verify-otp, their session contains userIdentifier.
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
  res.render("auth/verify-otp.ejs");
});


app.post("/verify-otp", asyncWrap(async (req, res) => {
  console.log("🔍 Incoming OTP Verification Request");

  // Log entire request body
  console.log("📦 req.body:", req.body);

  const { otp } = req.body;
  const email = req.session.userIdentifier;//Gets the email stored in session

  console.log("📧 Session Email:", email);
  console.log("🔢 Entered OTP:", otp);

  if (!email) {
    console.log("⚠️ No session email found!");
    return res.send("Session expired or email not found.");
  }

  const otpRecords = await OTP.find({ userIdentifier: email }).sort({ createdAt: -1 }); //Fetches all OTP records for that email, sorted by newest first.
  console.log("📜 All OTP records for this email:", otpRecords);

  if (otpRecords.length === 0) return res.send("No OTP record found.");

  const latestOtp = otpRecords[0];//Picks the latest OTP (first element of the sorted array)
  console.log("✅ Latest OTP from DB:", latestOtp.otp);

  if (latestOtp.otp !== otp) { //Compares the latest OTP from the database with the one entered by the user.
    console.log("❌ OTP Mismatch");
    return res.send("Invalid OTP");
  }

  await OTP.deleteOne({ _id: latestOtp._id });  //Deletes the OTP record after successful verification (so it can’t be reused)
  console.log("🗑️ OTP record deleted");

  req.session.tempUserIdentifier = email;  //Saves tempUserIdentifier into the session. (You might later use this in /set-password route to associate the password setup with this verified email)
  
console.log("🎉 OTP verified, session updated");

  res.redirect("/set-password");
}));



// Set Password
app.get("/set-password", (req, res) => res.render("auth/set-password.ejs"));

app.post("/set-password", asyncWrap(async (req, res) => {
  const { password } = req.body; //This takes the password entered by the user from the form submission
  const hashed = await bcrypt.hash(password, 12); //Uses bcrypt to hash the password with a salt rounds value of 12 (which makes it securely hashed before storing in the database).
  const user = new User({ email: req.session.tempUserIdentifier, password: hashed });
  await user.save();

  req.session.userId = user._id;
  
  res.redirect("/notes");
}));

// Login
app.get("/login", (req, res) => res.render("auth/login.ejs"));

app.post("/login", asyncWrap(async (req, res) => { // Listens for a POST request when the login form is submitted
  const { email, password } = req.body;
  const user = await User.findOne({ email });//Searches your users collection for a user document with a matching email.
  if (!user) return res.send("No user");

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.send("Invalid Password");

  req.session.userId = user._id; //this line saves the logged-in user’s _id in the session under the key userId.
  if (!req.session.userId) return res.redirect("/login");
  res.redirect("/notes"); 
}));

// Logout
app.get("/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/login");
});

// 404 Handler
app.use((req, res) => res.status(404).render("404.ejs", { message: "Page not found!" })); //If none of the defined routes above it match the incoming request URL, this middleware gets triggered.

// Error Handler
app.use((err, req, res, next) => {
  console.error(err); //Logs the error details (stack trace, status, message etc) in your terminal console for debugging.
  const { status = 500, message = "Something went wrong!" } = err;  //Destructuring assignment to extract status and message from the err object. If those properties don’t exist on the err object, it uses: 500 as default HTTP status (Internal Server Error)"Something went wrong!" as a default error message
  res.status(status).render("404.ejs", { message });  //res.status(status) → Sets the HTTP response status code to whatever status we just got.
});  //If you call next(err) or an error happens inside an asyncWrap()-wrapped route, the error is passed here.

// Server Start
app.listen(8080, () => console.log("Server running on 8080"));
