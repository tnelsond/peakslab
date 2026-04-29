#include <ctype.h>

#define NOP 0
#define CAPITAL_SINGLE 1
#define CAPITAL_RUN_START 2
#define CAPITAL_RUN_END 3
#define ZWS 4
#define PSPACE 5

#define PEAK 0x1
#define SLAB 0x2
#define PCOMP 0x4
#define NOSORT 0x8

#pragma pack(push, 1)
struct peakslab{ // 80 Byte header, should be pretty future proof. We don't care about absolute smallest, because we're just gonna compress it all out anyway.
	//8 Bytes
	uint8_t binarybyte; //0
	uint8_t magicnum[3]; //F2FCF3
	uint8_t magicstr[4]; // Peak
	// 8 Bytes
	uint16_t version;
	uint8_t features;
	uint8_t btagdef_idx;
	uint8_t btag_idx; 
	uint8_t btag1;
	uint8_t btag2; 
	uint8_t bline_idx; 
	// 8 Bytes
	uint32_t tagdef_idx_start;
	uint32_t tagdef_idx_len;
	// 8 Bytes
	uint32_t tagdef_start;
	uint32_t tagdef_len; 
	// 8 Bytes
	uint32_t tag_idx_start;
	uint32_t tag_idx_len; // Should match the number of linestarts or be zero
	// 8 Bytes
	uint32_t tag_start;
	uint32_t tag_len; 
	// 8 Bytes
	uint32_t line_idx_start;
	uint32_t line_idx_len;
	// 8 Bytes
	uint32_t line_start;
	uint32_t line_len;
	// 8 Bytes;
	uint32_t idx2_start;
	uint32_t idx2_len;
	// 8 Bytes
	uint32_t idx3_start;
	uint32_t idx3_len;
};
#pragma pack(pop)
//	binarybyte; magicnum; magicstr;
//	version; features; btagdef_idx; btag_idx; btag1; btag2; bline_idx; 
//	tagdef_idx_start; tagdef_idx_len;
//  tagdef_start; tagdef_len; 
//  tag_idx_start; tag_idx_len;
//  tag_start; tag_len; 
//	line_idx_start; line_idx_len;
//	line_start; line_len;
//	idx2_start; idx2_len;
//	idx3_start; idx3_len;

