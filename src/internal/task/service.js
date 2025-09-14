import Task from "../../models/task.js";

export const createTask = async (data) => {
  const task = new Task(data);
  return await task.save();
};

export const getTasks = async (filter = {}) => {
  return await Task.find(filter);
};

export const getTaskById = async (id) => {
  return await Task.findOne({ id });
};

export const updateTask = async (id, data) => {
  return await Task.findOneAndUpdate({ id }, data, { new: true });
};

export const deleteTask = async (id) => {
  return await Task.findOneAndDelete({ id });
};
