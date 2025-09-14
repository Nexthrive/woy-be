import User from "../../models/user.js";

export const sendFriendRequest = async (req, res) => {
  try {
    const { fromUserId, toUserId } = req.body;

    if (fromUserId === toUserId) {
      return res.status(400).json({ message: "Tidak bisa add diri sendiri" });
    }

    const fromUser = await User.findById(fromUserId);
    const toUser = await User.findById(toUserId);

    if (!fromUser || !toUser) {
      return res.status(404).json({ message: "User tidak ditemukan" });
    }

    // Cek kalau udah temenan
    if (fromUser.friends.includes(toUserId)) {
      return res.status(400).json({ message: "Sudah berteman" });
    }

    // Cek kalau request sudah pernah dikirim
    if (toUser.friendRequests.includes(fromUserId)) {
      return res.status(400).json({ message: "Request sudah dikirim" });
    }

    toUser.friendRequests.push(fromUserId);
    await toUser.save();

    return res.json({ message: "Request terkirim" });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

export const acceptFriendRequest = async (req, res) => {
  try {
    const { fromUserId, toUserId } = req.body;
    // fromUserId = pengirim request
    // toUserId   = penerima yang sekarang accept

    const fromUser = await User.findById(fromUserId);
    const toUser = await User.findById(toUserId);

    if (!fromUser || !toUser) {
      return res.status(404).json({ message: "User tidak ditemukan" });
    }

    // Pastikan ada request dulu
    if (!toUser.friendRequests.includes(fromUserId)) {
      return res.status(400).json({ message: "Tidak ada request" });
    }

    // Tambah teman dua arah
    fromUser.friends.push(toUserId);
    toUser.friends.push(fromUserId);

    // Hapus dari daftar request
    toUser.friendRequests = toUser.friendRequests.filter(
      (id) => id.toString() !== fromUserId,
    );

    await fromUser.save();
    await toUser.save();

    return res.json({ message: "Berhasil jadi teman" });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};
