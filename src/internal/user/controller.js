import * as userService from "./service.js";
import User from "../../models/user.js";

export const getUsers = async (req, res, next) => {
  try {
    const users = await userService.getUsers();
    res.json(users);
  } catch (err) {
    next(err);
  }
};

export const getUserById = async (req, res, next) => {
  try {
    const user = await userService.getUserById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (err) {
    next(err);
  }
};

export const updateUser = async (req, res, next) => {
  try {
    const user = await userService.updateUser(req.params.id, req.body);
    res.json(user);
  } catch (err) {
    next(err);
  }
};

export const deleteUser = async (req, res, next) => {
  try {
    await userService.deleteUser(req.params.id);
    res.json({ message: "User deleted" });
  } catch (err) {
    next(err);
  }
};

export const getAllUserByPoints = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const result = await userService.getUserByPoints(page, 10);
    res.json(result);
  } catch (err) {
    next(err);
  }
};
