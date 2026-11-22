export default {
  expo: {
    name: 'Restaurant POS Waiter',
    slug: 'restaurant-pos-waiter',
    version: '0.1.0',
    orientation: 'portrait',
    userInterfaceStyle: 'automatic',
    android: {
      package: 'com.example.restaurantposwaiter',
      permissions: []
    },
    plugins: ['expo-secure-store', 'expo-sqlite'],
    extra: {
      apiOrigin: process.env.EXPO_PUBLIC_POS_API_ORIGIN || '',
      localApiOrigin: process.env.EXPO_PUBLIC_POS_LOCAL_API_ORIGIN || '',
      cloudApiOrigin: process.env.EXPO_PUBLIC_POS_CLOUD_API_ORIGIN || ''
    }
  }
};
