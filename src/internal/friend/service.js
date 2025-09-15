import User from "../../models/user.js";
import mongoose from "mongoose";

export const validateObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

export const findUserById = async (userId) => {
  if (!validateObjectId(userId)) return null;
  return await User.findById(userId);
};

export const sendFriendRequestService = async ({ fromUserId, toUserId }) => {
  if (fromUserId === toUserId) {
    return { status: 400, body: { message: "Tidak bisa add diri sendiri" } };
  }

  if (!validateObjectId(fromUserId) || !validateObjectId(toUserId)) {
    return { status: 400, body: { message: "Invalid userId format" } };
  }

  const [fromUser, toUser] = await Promise.all([
    User.findById(fromUserId),
    User.findById(toUserId),
  ]);

  if (!fromUser || !toUser) {
    return { status: 404, body: { message: "User tidak ditemukan" } };
  }

  if (fromUser.friends.includes(toUserId)) {
    return { status: 400, body: { message: "Sudah berteman" } };
  }

  if (toUser.friendRequests.includes(fromUserId)) {
    return { status: 400, body: { message: "Request sudah dikirim" } };
  }

  toUser.friendRequests.push(fromUserId);
  await toUser.save();

  return { status: 200, body: { message: "Request terkirim" } };
};

export const acceptFriendRequestService = async ({ toUserId, fromUserId }) => {
  if (!validateObjectId(fromUserId) || !validateObjectId(toUserId)) {
    return { status: 400, body: { message: "Invalid userId format" } };
  }

  const [fromUser, toUser] = await Promise.all([
    User.findById(fromUserId),
    User.findById(toUserId),
  ]);

  if (!fromUser || !toUser) {
    return { status: 404, body: { message: "User tidak ditemukan" } };
  }

  if (!toUser.friendRequests.includes(fromUserId)) {
    return { status: 400, body: { message: "Tidak ada request" } };
  }

  fromUser.friends.push(toUserId);
  toUser.friends.push(fromUserId);
  toUser.friendRequests = toUser.friendRequests.filter(
    (id) => id.toString() !== fromUserId,
  );

  await Promise.all([fromUser.save(), toUser.save()]);

  return { status: 200, body: { message: "Berhasil jadi teman" } };
};

export const getFriendsListService = async ({ userId }) => {
  if (!validateObjectId(userId)) {
    return { status: 400, body: { message: "Invalid userId format" } };
  }

  const user = await User.findById(userId).select("friends");
  if (!user) {
    return { status: 404, body: { message: "User tidak ditemukan" } };
  }

  const userWithFriends = await User.findById(userId)
    .populate("friends", "name email points")
    .select("friends");

  return {
    status: 200,
    body: {
      message: "Daftar teman berhasil diambil",
      friends: userWithFriends.friends,
    },
  };
};

export const getFriendsLeaderboardService = async ({ userId, page = 1, limit = 10 }) => {
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);

  if (pageNum < 1 || limitNum < 1 || limitNum > 100) {
    return {
      status: 400,
      body: {
        message: "Invalid pagination parameters. Page must be >= 1, limit must be 1-100",
      },
    };
  }

  if (!validateObjectId(userId)) {
    return { status: 400, body: { message: "Invalid userId format" } };
  }

  const user = await User.findById(userId).select("friends");
  if (!user) {
    return { status: 404, body: { message: "User tidak ditemukan" } };
  }

  const skip = (pageNum - 1) * limitNum;

  const [friends, totalFriends] = await Promise.all([
    User.find({ _id: { $in: user.friends } })
      .sort({ points: -1 })
      .skip(skip)
      .limit(limitNum)
      .select("name email points"),
    User.countDocuments({ _id: { $in: user.friends } }),
  ]);

  return {
    status: 200,
    body: {
      message: "Leaderboard teman berhasil diambil",
      data: {
        page: pageNum,
        totalPages: Math.ceil(totalFriends / limitNum),
        totalFriends,
        friends,
      },
    },
  };
};

export const removeFriendService = async ({ userId, friendId }) => {
  if (!validateObjectId(userId) || !validateObjectId(friendId)) {
    return { status: 400, body: { message: "Invalid userId or friendId format" } };
  }

  if (userId === friendId) {
    return { status: 400, body: { message: "Tidak bisa menghapus diri sendiri" } };
  }

  const [user, friend] = await Promise.all([
    User.findById(userId),
    User.findById(friendId),
  ]);

  if (!user || !friend) {
    return { status: 404, body: { message: "User tidak ditemukan" } };
  }

  const areFriends = user.friends.some((id) => id.toString() === friendId) &&
    friend.friends.some((id) => id.toString() === userId);

  if (!areFriends) {
    return { status: 400, body: { message: "Bukan teman" } };
  }

  user.friends = user.friends.filter((id) => id.toString() !== friendId);
  friend.friends = friend.friends.filter((id) => id.toString() !== userId);

  await Promise.all([user.save(), friend.save()]);

  return { status: 200, body: { message: "Teman berhasil dihapus" } };
};
