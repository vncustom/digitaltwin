// Chỉ khai báo những trường bot dùng tới.
export interface TgUser {
  id: number;
  first_name?: string;
  username?: string;
}
export interface TgChat {
  id: number;
  type: string;
}
export interface TgDocument {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}
export interface TgPhotoSize {
  file_id: string;
  width: number;
  height: number;
  file_size?: number;
}
export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  date: number;
  text?: string;
  caption?: string;
  document?: TgDocument;
  photo?: TgPhotoSize[];
}
export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
}
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}
