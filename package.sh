#!/bin/bash -e
yarn --version > /dev/null 2>&1 \
|| { echo "error: yarn not found (try: npm install -g yarn)" ; exit 1; }

date=$(git log -1 --date=short --pretty=format:%cd || date -u)

rm -rf node_modules
if [ -z "${ADDON_ARCH}" ]; then
  TARFILE_SUFFIX=
else
  NODE_VERSION="$(node --version)"
  TARFILE_SUFFIX="-${ADDON_ARCH}-${NODE_VERSION/\.*/}"
fi
if [ "${ADDON_ARCH}" == "linux-arm" ]; then
  # We assume that CC and CXX are pointing to the cross compilers
  yarn --ignore-scripts --production
  npm rebuild --arch=armv6l --target_arch=arm
else
  yarn install --production
fi

rm -f SHA256SUMS
sha256sum package.json *.js LICENSE > SHA256SUMS
find node_modules -type f -exec sha256sum {} \; >> SHA256SUMS
TARFILE="$(npm pack)"
if [ "${ADDON_ARCH}" == "darwin-x64" ]; then
  alias tar=gtar
fi
tar xzf ${TARFILE}
rm ${TARFILE}
TARFILE_ARCH="${TARFILE/.tgz/${TARFILE_SUFFIX}.tgz}"
cp -r node_modules ./package
GZIP="-n" tar czf "${TARFILE_ARCH}" --mtime="${date}" package
rm -rf package
echo "Created ${TARFILE_ARCH}"
sha256sum "${TARFILE_ARCH}"
