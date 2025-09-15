import { getJWTData } from "../../middleware/auth.js";
import * as friendService from "./service.js";

export const sendFriendRequest = async (req, res) => {
  try {
    const jwtResult = getJWTData(req);
    if (!jwtResult.success) {
      return res
        .status(401)
        .json({ message: "Unauthorized: " + jwtResult.error });
    }

    const fromUserId = jwtResult.data.userId;
    const { toUserId } = req.body;

    const result = await friendService.sendFriendRequestService({
      fromUserId,
      toUserId,
    });
    return res.status(result.status).json(result.body);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

export const acceptFriendRequest = async (req, res) => {
  try {
    const jwtResult = getJWTData(req);
    if (!jwtResult.success) {
      return res
        .status(401)
        .json({ message: "Unauthorized: " + jwtResult.error });
    }

    const toUserId = jwtResult.data.userId;
    const { fromUserId } = req.body;

    const result = await friendService.acceptFriendRequestService({
      toUserId,
      fromUserId,
    });
    return res.status(result.status).json(result.body);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

export const getFriendsList = async (req, res) => {
  try {
    const jwtResult = getJWTData(req);
    if (!jwtResult.success) {
      return res
        .status(401)
        .json({ message: "Unauthorized: " + jwtResult.error });
    }

    const userId = jwtResult.data.userId;
    const result = await friendService.getFriendsListService({ userId });
    return res.status(result.status).json(result.body);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

export const getLeaderboard = async (req, res) => {
  try {
    const jwtResult = getJWTData(req);
    if (!jwtResult.success) {
      return res
        .status(401)
        .json({ message: "Unauthorized: " + jwtResult.error });
    }

    const userId = jwtResult.data.userId;
    const { page = 1, limit = 10 } = req.query;

    const result = await friendService.getFriendsLeaderboardService({
      userId,
      page,
      limit,
    });
    return res.status(result.status).json(result.body);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

export const removeFriend = async (req, res) => {
  try {
    const jwtResult = getJWTData(req);
    if (!jwtResult.success) {
      return res
        .status(401)
        .json({ message: "Unauthorized: " + jwtResult.error });
    }

    const userId = jwtResult.data.userId;
    const { friendId } = req.body;

    const result = await friendService.removeFriendService({
      userId,
      friendId,
    });
    return res.status(result.status).json(result.body);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};
