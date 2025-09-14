import User from "../../models/user.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // 1. Validasi basic
    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email dan password wajib diisi" });
    }

    // 2. Cari user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User tidak ditemukan" });
    }

    // 3. Bandingkan password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Email atau password salah" });
    }

    // 4. Generate token
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET, // fallback biar ga error kalau lupa
      { expiresIn: "12h" },
    );

    return res.status(200).json({
      message: "Login berhasil",
      name: user.name,
      token,
    });
  } catch (error) {
    next(error);
  }
};
