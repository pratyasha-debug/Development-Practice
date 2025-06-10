const mongoose = require("mongoose");

// Note Schema
const noteSchema = new mongoose.Schema({
  title: String,
  content: String,
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, { timestamps: true });

// Export model
module.exports = mongoose.model("Note", noteSchema);
