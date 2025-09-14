import User from "../../models/user.js";

export const createUser = async (data) => {
  return await User.create(data);
};

export const getUsers = async () => {
  return await User.find();
};

export const getUserById = async (id) => {
  return await User.findById(id);
};

export const getUserByEmail = async (email) => {
  return await User.findOne({ email });
};

export const updateUser = async (id, data) => {
  return await User.findByIdAndUpdate(id, data, { new: true });
};

export const deleteUser = async (id) => {
  return await User.findByIdAndDelete(id);
};

export const getUserByPoints = async (page = 1, limit = 10) => {
  const skip = (page - 1) * limit;

  const [users, totalUsers] = await Promise.all([
    User.find({})
      .sort({ points: -1 })
      .skip(skip)
      .limit(limit)
      .select("name points"),
    User.countDocuments({}),
  ]);

  return {
    page,
    totalPages: Math.ceil(totalUsers / limit),
    totalUsers,
    data: users,
  };
};
