'use strict';

function slugOf(name) {
  return String(name).trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\u0142/g, 'l')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function dirSegment(segment) {
  const parameter = String(segment).match(/^\{(.+)\}$/);
  return parameter ? '_' + slugOf(parameter[1]) : segment;
}

module.exports = { slugOf, dirSegment };
