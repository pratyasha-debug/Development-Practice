const mongoose = require("mongoose");

const otpSchema = new mongoose.Schema({
  userIdentifier: {
    type:String,
    required: true
  },
  otp: String,
  createdAt: Date
});

module.exports = mongoose.model("OTP", otpSchema);
