#pragma once
static inline int isdigit(int c){ return (unsigned)c - '0' < 10; }
static inline int toupper(int c){ return (unsigned)c - 'a' < 26 ? c - 32 : c; }
static inline int tolower(int c){ return (unsigned)c - 'A' < 26 ? c + 32 : c; }
