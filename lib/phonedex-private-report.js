"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function writePrivateReport(outputPath, contents) {
  const destination = path.resolve(outputPath);
  const directory = path.dirname(destination);
  const name = path.basename(destination);

  try {
    if (fs.lstatSync(destination).isSymbolicLink()) {
      throw new Error("refusing to write a report through a symbolic link");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const temporary = path.join(directory, `.${name}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`);
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    fs.writeFileSync(descriptor, contents, "utf8");
    fs.fchmodSync(descriptor, 0o600);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, destination);
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try { fs.unlinkSync(temporary); } catch (cleanupError) {
      if (cleanupError.code !== "ENOENT") throw error;
    }
    throw error;
  }
}

module.exports = { writePrivateReport };
