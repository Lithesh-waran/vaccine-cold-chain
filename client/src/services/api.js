import axios from 'axios';

export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api', timeout: 20000 });
let unauthorizedHandler = null;
export const setUnauthorizedHandler = (fn) => { unauthorizedHandler = fn; };
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('vcc_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
api.interceptors.response.use((response) => response, (error) => {
  if (error.response?.status === 401) unauthorizedHandler?.();
  return Promise.reject(error);
});
export const dataOf = (response) => response.data?.data;
export const listOf = (response) => Array.isArray(response.data?.data) ? response.data.data : response.data?.data?.items || [];
export const errorMessage = (error) => error.response?.data?.message || (error.code === 'ERR_NETWORK' ? 'Unable to connect to backend. Check that the API is running.' : error.message || 'Something went wrong');
