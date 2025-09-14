import User from "../../models/user.js";
import * as userService from "../user/service.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email dan password wajib diisi" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User tidak ditemukan" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Email atau password salah" });
    }

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

export const register = async (req, res, next) => {
  try {
    const { email, password, name, ...rest } = req.body;

    if (!email || !password || !name) {
      return res
        .status(400)
        .json({ message: "Name, email, dan password wajib diisi" });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ message: "Email sudah terdaftar" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await userService.createUser({
      email,
      password: hashedPassword,
      name,
      ...rest,
    });

    const token = jwt.sign(
      { userId: user._id, name: user.name },
      process.env.JWT_SECRET,
      { expiresIn: "12h" },
    );

    return res.status(201).json({
      name: user.name,
      token,
    });
  } catch (err) {
    next(err);
  }
};
